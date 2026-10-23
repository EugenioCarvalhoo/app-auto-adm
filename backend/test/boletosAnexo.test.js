/**
 * POST /api/boletos/:id/anexo (grava a imagem confirmada de um boleto já cadastrado). Storage fake em memória,
 * Postgres real. Confere sempre o efeito no banco E no storage (nenhum objeto órfão).
 */
const crypto = require('crypto');
const request = require('supertest');
const { usarBancoReal, auth, U } = require('./helpers/setup');
const { jpeg, png, webp } = require('./helpers/imagens');
const { definirStorage } = require('../lib/storage');
const { criarStorageFake } = require('./helpers/storageFake');

const env = usarBancoReal();

const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const CHAVES_ENV = ['STORAGE_ENDPOINT', 'STORAGE_BUCKET', 'STORAGE_ACCESS_KEY', 'STORAGE_SECRET_KEY'];

function enviar(usuario, id, { imagem = jpeg(1), mime = 'image/jpeg', hash, semHash = false, semImagem = false, nome = 'foto.jpg' } = {}) {
  let req = request(env.app).post(`/api/boletos/${id}/anexo`).set(auth(usuario));
  if (!semHash) req = req.field('hash_sha256', hash === undefined ? sha(imagem) : hash);
  if (!semImagem) req = req.attach('imagem', imagem, { filename: nome, contentType: mime });
  return req;
}

const anexosDe = (id) => env.rows('SELECT * FROM boletos_anexos WHERE boleto_id = $1', [id]);
const totalAnexos = async () => Number((await env.um('SELECT count(*) AS n FROM boletos_anexos')).n);

describe('POST /api/boletos/:id/anexo', () => {
  let storage;

  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    storage = criarStorageFake();
    definirStorage(storage);
  });
  afterEach(() => {
    definirStorage(null);
    jest.restoreAllMocks();
  });

  /** Nada foi gravado: nem linha no banco, nem objeto no storage. */
  const nadaGravado = async () => {
    expect(await totalAnexos()).toBe(0);
    expect(storage.chaves()).toEqual([]);
  };

  describe('autenticação e autorização', () => {
    it('401 sem token', async () => {
      await request(env.app).post('/api/boletos/10/anexo').field('hash_sha256', sha(jpeg())).attach('imagem', jpeg(), { filename: 'a.jpg', contentType: 'image/jpeg' }).expect(401);
      await nadaGravado();
    });

    it('403 sem o módulo de boletos e 403 sem vínculo', async () => {
      await enviar(U.semModulo, 10).expect(403);
      await enviar(U.semVinculo, 10).expect(403);
      await nadaGravado();
    });

    it('IDOR: gerente do restaurante B não anexa imagem ao boleto do restaurante A (403, nada gravado)', async () => {
      await enviar(U.gerenteB, 10).expect(403);
      await nadaGravado();
    });

    it('IDOR inverso: gerente do restaurante A não anexa ao boleto do restaurante B', async () => {
      await enviar(U.gerenteA, 20).expect(403);
      await nadaGravado();
    });

    it('admin anexa em qualquer restaurante; a chave do objeto leva o restaurante DO BOLETO', async () => {
      const res = await enviar(U.admin, 20).expect(201);
      expect(res.body).toMatchObject({ id: 20, restaurante_id: 2, tem_anexo: true });
      const [a] = await anexosDe(20);
      expect(a).toMatchObject({ restaurante_id: 2, usuario_id: 1 });
      expect(a.storage_chave).toMatch(/^2\/[a-f0-9]{32}\.jpg$/);
    });

    it('o restaurante vem do boleto, nunca do corpo (restaurante_id forjado é ignorado)', async () => {
      const res = await enviar(U.gerenteA, 10).field('restaurante_id', '2').expect(201);
      expect(res.body.restaurante_id).toBe(1);
      expect((await anexosDe(10))[0].restaurante_id).toBe(1);
      expect(storage.chaves()[0]).toMatch(/^1\//);
    });
  });

  describe('sucesso', () => {
    it('201: grava a linha (hash, mime, tamanho, usuário), guarda os mesmos bytes e devolve o boleto com a imagem', async () => {
      const imagem = jpeg(50);
      const res = await enviar(U.gerenteA, 10, { imagem }).expect(201);
      const [a] = await anexosDe(10);
      expect(a).toMatchObject({ boleto_id: 10, restaurante_id: 1, usuario_id: 2, mime: 'image/jpeg', tamanho_bytes: imagem.length, hash_sha256: sha(imagem) });
      expect(res.body).toMatchObject({ id: 10, anexo_id: a.id, tem_anexo: true });
      expect(JSON.stringify(res.body)).not.toContain(a.storage_chave);
      expect(storage.chaves()).toEqual([a.storage_chave]);
      expect(storage.objetos.get(a.storage_chave).conteudo.equals(imagem)).toBe(true);
      expect(storage.objetos.get(a.storage_chave).mime).toBe('image/jpeg');
    });

    it('depois de anexar, GET /anexo devolve exatamente os mesmos bytes', async () => {
      const imagem = png(51);
      await enviar(U.gerenteA, 10, { imagem, mime: 'image/png', nome: 'a.png' }).expect(201);
      const get = await request(env.app)
        .get('/api/boletos/10/anexo')
        .set(auth(U.gerenteA))
        .buffer(true)
        .parse((r, cb) => {
          const partes = [];
          r.on('data', (c) => partes.push(c));
          r.on('end', () => cb(null, Buffer.concat(partes)));
        })
        .expect(200);
      expect(get.headers['content-type']).toBe('image/png');
      expect(get.body.equals(imagem)).toBe(true);
    });

    it.each([
      ['jpg', jpeg(1), 'image/jpeg', 'image/jpeg'],
      ['png', png(1), 'image/png', 'image/png'],
      ['webp', webp(1), 'image/webp', 'image/webp']
    ])('aceita %s com MIME coerente e grava a extensão certa', async (ext, imagem, mime, esperado) => {
      await enviar(U.gerenteA, 10, { imagem, mime, nome: `a.${ext}` }).expect(201);
      const [a] = await anexosDe(10);
      expect(a.mime).toBe(esperado);
      expect(a.storage_chave.endsWith(`.${ext}`)).toBe(true);
    });

    it('hash em MAIÚSCULAS e com espaços é aceito (normalizado)', async () => {
      const imagem = jpeg(52);
      await enviar(U.gerenteA, 10, { imagem, hash: `  ${sha(imagem).toUpperCase()} ` }).expect(201);
      expect((await anexosDe(10))[0].hash_sha256).toBe(sha(imagem));
    });

    it('anexar não altera os dados do boleto', async () => {
      const antes = await env.um('SELECT descricao, valor, dt_vencimento, tipo, pago FROM boletos_notas WHERE id = 10');
      await enviar(U.gerenteA, 10).expect(201);
      expect(await env.um('SELECT descricao, valor, dt_vencimento, tipo, pago FROM boletos_notas WHERE id = 10')).toEqual(antes);
    });
  });

  describe('hash_sha256', () => {
    it('hash de OUTRA imagem => 400 e nada gravado (a imagem anexada tem que ser a que foi lida)', async () => {
      const res = await enviar(U.gerenteA, 10, { imagem: jpeg(1), hash: sha(jpeg(2)) }).expect(400);
      expect(res.body.error).toMatch(/hash/i);
      await nadaGravado();
    });

    it('um byte alterado na imagem muda o hash => 400', async () => {
      const original = jpeg(3);
      const adulterada = Buffer.from(original);
      adulterada[adulterada.length - 1] ^= 0xff;
      await enviar(U.gerenteA, 10, { imagem: adulterada, hash: sha(original) }).expect(400);
      await nadaGravado();
    });

    it.each([
      ['ausente', { semHash: true }],
      ['vazio', { hash: '' }],
      ['curto', { hash: 'abc123' }],
      ['não hexadecimal', { hash: 'z'.repeat(64) }],
      ['longo demais', { hash: 'a'.repeat(65) }]
    ])('hash %s => 400 e nada gravado', async (_n, opcoes) => {
      await enviar(U.gerenteA, 10, opcoes).expect(400);
      await nadaGravado();
    });
  });

  describe('imagem inválida', () => {
    it('400 sem o arquivo', async () => {
      await enviar(U.gerenteA, 10, { semImagem: true, hash: sha(jpeg()) }).expect(400);
      await nadaGravado();
    });

    it('413 acima de 5 MB', async () => {
      const grande = Buffer.concat([jpeg(), Buffer.alloc(5 * 1024 * 1024 + 10)]);
      await enviar(U.gerenteA, 10, { imagem: grande }).expect(413);
      await nadaGravado();
    });

    it('415: PNG declarado como JPEG, HTML disfarçado e formatos não suportados', async () => {
      await enviar(U.gerenteA, 10, { imagem: png(), mime: 'image/jpeg' }).expect(415);
      await enviar(U.gerenteA, 10, { imagem: Buffer.from('<script>alert(1)</script>'), mime: 'image/jpeg' }).expect(415);
      await enviar(U.gerenteA, 10, { imagem: Buffer.from('GIF89a......'), mime: 'image/gif', nome: 'a.gif' }).expect(415);
      await enviar(U.gerenteA, 10, { imagem: Buffer.from('%PDF-1.4 ...'), mime: 'application/pdf', nome: 'a.pdf' }).expect(415);
      await nadaGravado();
    });

    it('corpo que não é multipart => 400', async () => {
      await request(env.app).post('/api/boletos/10/anexo').set(auth(U.gerenteA)).send({ hash_sha256: sha(jpeg()) }).expect(400);
      await nadaGravado();
    });
  });

  describe('boleto', () => {
    it('404 para boleto inexistente; 400 para id inválido; storage intocado', async () => {
      await enviar(U.admin, 9999).expect(404);
      await enviar(U.admin, 'abc').expect(400);
      await nadaGravado();
      expect(storage.chamadas.salvar).toBe(0);
    });

    it('404 para boleto excluído (soft delete), mesmo para o admin', async () => {
      await env.rows('UPDATE boletos_notas SET deleted_at = now() WHERE id = 10');
      await enviar(U.admin, 10).expect(404);
      await nadaGravado();
    });
  });

  describe('já tem imagem', () => {
    it('409 e a imagem original permanece intacta; o segundo envio não deixa objeto no storage', async () => {
      const primeira = jpeg(60);
      await enviar(U.gerenteA, 10, { imagem: primeira }).expect(201);
      const [original] = await anexosDe(10);

      const res = await enviar(U.gerenteA, 10, { imagem: jpeg(61) }).expect(409);
      expect(res.body.error).toMatch(/já tem imagem/);
      const depois = await anexosDe(10);
      expect(depois).toHaveLength(1);
      expect(depois[0]).toMatchObject({ id: original.id, hash_sha256: sha(primeira), storage_chave: original.storage_chave });
      expect(storage.chaves()).toEqual([original.storage_chave]);
      expect(storage.objetos.get(original.storage_chave).conteudo.equals(primeira)).toBe(true);
    });

    it('reenviar a MESMA imagem também é 409 (não duplica)', async () => {
      await enviar(U.gerenteA, 10, { imagem: jpeg(62) }).expect(201);
      await enviar(U.gerenteA, 10, { imagem: jpeg(62) }).expect(409);
      expect(await totalAnexos()).toBe(1);
      expect(storage.chaves()).toHaveLength(1);
    });

    it('admin também recebe 409 (não substitui a imagem)', async () => {
      await enviar(U.gerenteA, 10).expect(201);
      await enviar(U.admin, 10, { imagem: jpeg(63) }).expect(409);
    });

    it('o 409 vale por boleto: outro boleto aceita a mesma imagem', async () => {
      await enviar(U.admin, 10).expect(201);
      await enviar(U.admin, 20).expect(201);
      expect(await totalAnexos()).toBe(2);
    });

    it('corrida: dois envios simultâneos (ambos passam da checagem) => um 201, um 409 e NENHUM objeto órfão', async () => {
      // Barreira: as duas requisições chegam em storage.salvar antes de qualquer INSERT, forçando o 23505 do índice único.
      let chegaram = 0;
      let liberar;
      const barreira = new Promise((resolve) => {
        liberar = resolve;
      });
      const salvarOriginal = storage.salvar.bind(storage);
      storage.salvar = async (...args) => {
        chegaram += 1;
        if (chegaram === 2) liberar();
        await barreira;
        return salvarOriginal(...args);
      };
      const a = jpeg(70);
      const b = jpeg(71);
      const [r1, r2] = await Promise.all([enviar(U.gerenteA, 10, { imagem: a }), enviar(U.gerenteA, 10, { imagem: b })]);
      expect([r1.status, r2.status].sort()).toEqual([201, 409]);
      const vencedora = r1.status === 201 ? a : b;
      const linhas = await anexosDe(10);
      expect(linhas).toHaveLength(1);
      expect(linhas[0].hash_sha256).toBe(sha(vencedora));
      expect(storage.chaves()).toEqual([linhas[0].storage_chave]);
      expect(storage.chamadas.apagar).toBe(1); // o perdedor limpou o próprio objeto
    });
  });

  describe('boleto pago', () => {
    beforeEach(() => env.rows('UPDATE boletos_notas SET pago = true, pago_em = now(), pago_por_usuario_id = 1 WHERE id = 10'));

    it('não-admin => 403 e nada gravado', async () => {
      const res = await enviar(U.gerenteA, 10).expect(403);
      expect(res.body.error).toMatch(/Boleto pago/);
      await nadaGravado();
    });

    it('não-admin com pode_marcar_pago continua 403 (a permissão é só para dar baixa)', async () => {
      await env.rows('UPDATE usuarios SET pode_marcar_pago = true WHERE id = 2');
      await enviar(U.gerenteA, 10).expect(403);
      await nadaGravado();
    });

    it('admin anexa em boleto pago (201)', async () => {
      await enviar(U.admin, 10).expect(201);
      expect(await anexosDe(10)).toHaveLength(1);
      expect((await env.um('SELECT pago FROM boletos_notas WHERE id = 10')).pago).toBe(true);
    });

    it('o 403 do pago vale antes de qualquer outra validação (mesmo com hash errado)', async () => {
      await enviar(U.gerenteA, 10, { hash: sha(jpeg(99)) }).expect(403);
    });
  });

  describe('storage', () => {
    it('503 sem storage configurado: o boleto continua existindo e nada é gravado; vale até com imagem inválida', async () => {
      definirStorage(null);
      const guardado = Object.fromEntries(CHAVES_ENV.map((k) => [k, process.env[k]]));
      CHAVES_ENV.forEach((k) => delete process.env[k]);
      try {
        const res = await enviar(U.gerenteA, 10).expect(503);
        expect(res.body.error).toMatch(/não configurado/);
        await enviar(U.gerenteA, 10, { imagem: Buffer.from('lixo'), mime: 'image/jpeg' }).expect(503);
        expect(await totalAnexos()).toBe(0);
        expect(await env.um('SELECT id FROM boletos_notas WHERE id = 10')).toBeTruthy();
      } finally {
        CHAVES_ENV.forEach((k) => {
          if (guardado[k] !== undefined) process.env[k] = guardado[k];
        });
      }
    });

    it('o 503 não ocorre para quem não tem acesso: 403 vem antes (sem vazar a configuração)', async () => {
      definirStorage(null);
      const guardado = Object.fromEntries(CHAVES_ENV.map((k) => [k, process.env[k]]));
      CHAVES_ENV.forEach((k) => delete process.env[k]);
      try {
        await enviar(U.gerenteB, 10).expect(403);
      } finally {
        CHAVES_ENV.forEach((k) => {
          if (guardado[k] !== undefined) process.env[k] = guardado[k];
        });
      }
    });

    it('storage.salvar falha => 500 genérico (sem vazar a causa), nenhuma linha no banco e storage vazio', async () => {
      storage.falhar.salvar = new Error('connect ECONNREFUSED 10.0.0.9:9000 secret=SEGREDO');
      const res = await enviar(U.gerenteA, 10).expect(500);
      expect(JSON.stringify(res.body)).not.toMatch(/ECONNREFUSED|SEGREDO|10\.0\.0\.9/);
      await nadaGravado();
      // o boleto segue intacto e o usuário pode tentar de novo
      storage.falhar.salvar = null;
      await enviar(U.gerenteA, 10).expect(201);
    });

    it('INSERT falha depois do salvar => apaga o objeto recém-gravado (nenhum órfão) e responde 500', async () => {
      // O boleto some entre a checagem e o INSERT: a FK de boletos_anexos falha (23503).
      const salvarOriginal = storage.salvar.bind(storage);
      storage.salvar = async (...args) => {
        const chave = await salvarOriginal(...args);
        await env.rows('DELETE FROM boletos_notas WHERE id = 10');
        return chave;
      };
      await enviar(U.gerenteA, 10).expect(500);
      expect(storage.chamadas.apagar).toBe(1);
      await nadaGravado();
    });

    it('INSERT falha e o apagar também falha: ainda responde 500 (não vira exceção não tratada)', async () => {
      const salvarOriginal = storage.salvar.bind(storage);
      storage.salvar = async (...args) => {
        const chave = await salvarOriginal(...args);
        await env.rows('DELETE FROM boletos_notas WHERE id = 10');
        storage.falhar.apagar = new Error('storage fora do ar');
        return chave;
      };
      await enviar(U.gerenteA, 10).expect(500);
      expect(await totalAnexos()).toBe(0);
    });
  });

  describe('POST/PUT /api/boletos ignoram anexo_id (contrato novo)', () => {
    it('anexo_id no POST não cria vínculo; a imagem só entra por /anexo', async () => {
      await enviar(U.gerenteA, 10).expect(201);
      const [existente] = await anexosDe(10);
      const res = await request(env.app)
        .post('/api/boletos')
        .set(auth(U.gerenteA))
        .send({ restaurante_id: 1, descricao: 'Novo', valor: 10, tipo: 'Sem Boleto', dt_recebimento: '2026-10-20', anexo_id: existente.id })
        .expect(201);
      expect(res.body.anexo_id).toBeNull();
      expect((await env.um('SELECT boleto_id FROM boletos_anexos WHERE id = $1', [existente.id])).boleto_id).toBe(10);
    });
  });
});
