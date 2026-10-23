/**
 * POST /api/boletos/extrair (leitura por IA). O Gemini NUNCA é chamado: o extrator é injetado.
 * A rota só LÊ a imagem em memória: não grava anexo no banco nem objeto no storage (um storage fake em memória
 * prova que ele nem é tocado). Postgres real.
 */
const crypto = require('crypto');
const request = require('supertest');
const { usarBancoReal, auth, U } = require('./helpers/setup');
const { linha47 } = require('./helpers/linhas');
const { jpeg, png, webp } = require('./helpers/imagens');
const { definirExtratorImagem, GeminiErro } = require('../lib/gemini');
const { definirStorage } = require('../lib/storage');
const { criarStorageFake } = require('./helpers/storageFake');
const { extrairRateLimit } = require('../lib/rateLimit');

const env = usarBancoReal();

const ROTA = '/api/boletos/extrair';
const LINHA = linha47(1);

const extracaoBoleto = (extra = {}) => ({
  tipo_documento: 'boleto',
  fornecedor: 'Distribuidora Sol',
  valor: 321.45,
  dt_vencimento: '2026-11-10',
  dt_documento: '2026-10-21',
  linha_digitavel: LINHA,
  ...extra
});

function enviar(usuario, { rid = 1, imagem = jpeg(1), mime = 'image/jpeg', nome = 'foto.jpg', extra = {} } = {}) {
  let req = request(env.app).post(ROTA).set(auth(usuario));
  if (rid !== null) req = req.field('restaurante_id', String(rid));
  Object.entries(extra).forEach(([k, v]) => {
    req = req.field(k, v);
  });
  if (imagem) req = req.attach('imagem', imagem, { filename: nome, contentType: mime });
  return req;
}

const contarAnexos = async () => Number((await env.um('SELECT count(*) AS n FROM boletos_anexos')).n);

describe('POST /api/boletos/extrair', () => {
  let storage;
  let extrator;
  const chaveOriginal = process.env.GEMINI_API_KEY;

  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    storage = criarStorageFake();
    definirStorage(storage);
    extrator = jest.fn(async () => extracaoBoleto());
    definirExtratorImagem(extrator);
    extrairRateLimit.reset();
    delete process.env.GEMINI_API_KEY;
  });

  afterEach(() => {
    definirExtratorImagem(null);
    definirStorage(null);
    extrairRateLimit.reset();
    if (chaveOriginal === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = chaveOriginal;
    jest.restoreAllMocks();
  });

  /** A leitura nunca grava: nem anexo no banco, nem objeto no storage, nem chama o storage. */
  const naoGravouNada = async () => {
    expect(await contarAnexos()).toBe(0);
    expect(storage.chaves()).toEqual([]);
    expect(storage.chamadas).toEqual({ salvar: 0, ler: 0, apagar: 0 });
  };
  const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

  describe('autenticação e autorização', () => {
    it('401 sem token', async () => {
      await request(env.app).post(ROTA).field('restaurante_id', '1').attach('imagem', jpeg(), { filename: 'a.jpg', contentType: 'image/jpeg' }).expect(401);
      expect(extrator).not.toHaveBeenCalled();
    });

    it('403 sem o módulo de boletos, mesmo vinculado', async () => {
      await enviar(U.semModulo).expect(403);
      expect(extrator).not.toHaveBeenCalled();
    });

    it('403 sem vínculo com nenhum restaurante', async () => {
      await enviar(U.semVinculo).expect(403);
      expect(extrator).not.toHaveBeenCalled();
    });

    it('IDOR: usuário do restaurante A não lê imagem para o restaurante B (403, sem IA, sem contar no teto, sem gravar)', async () => {
      await enviar(U.gerenteA, { rid: 2 }).expect(403);
      expect(extrator).not.toHaveBeenCalled();
      await naoGravouNada();
      expect(await env.rows('SELECT * FROM boletos_extracoes_uso')).toEqual([]);
    });

    it('admin lê para qualquer restaurante', async () => {
      const imagem = jpeg(41);
      const res = await enviar(U.admin, { rid: 2, imagem }).expect(200);
      expect(res.body.hash_sha256).toBe(sha(imagem));
      expect(extrator).toHaveBeenCalledTimes(1);
      await naoGravouNada();
    });

    it('400 sem restaurante_id', async () => {
      await enviar(U.gerenteA, { rid: null }).expect(400);
      expect(extrator).not.toHaveBeenCalled();
    });
  });

  describe('configuração', () => {
    it('503 sem chave do Gemini (e sem extrator injetado), sem gravar nada nem contar no teto', async () => {
      definirExtratorImagem(null);
      const res = await enviar(U.gerenteA).expect(503);
      expect(res.body.error).toMatch(/não configurada/);
      await naoGravouNada();
      expect(await env.rows('SELECT * FROM boletos_extracoes_uso')).toEqual([]);
    });

    it('a leitura funciona sem storage configurado (extrair não depende do armazenamento)', async () => {
      definirStorage(null);
      const chaves = ['STORAGE_ENDPOINT', 'STORAGE_BUCKET', 'STORAGE_ACCESS_KEY', 'STORAGE_SECRET_KEY'];
      const guardado = Object.fromEntries(chaves.map((k) => [k, process.env[k]]));
      chaves.forEach((k) => delete process.env[k]);
      try {
        const res = await enviar(U.gerenteA).expect(200);
        expect(res.body.tipo_sugerido).toBe('Boleto');
        expect(await contarAnexos()).toBe(0);
      } finally {
        chaves.forEach((k) => {
          if (guardado[k] !== undefined) process.env[k] = guardado[k];
        });
      }
    });
  });

  describe('validação do arquivo', () => {
    it('400 sem arquivo', async () => {
      await enviar(U.gerenteA, { imagem: null }).expect(400);
      expect(extrator).not.toHaveBeenCalled();
    });

    it('413 acima de 5 MB', async () => {
      const grande = Buffer.concat([jpeg(), Buffer.alloc(5 * 1024 * 1024 + 10)]);
      await enviar(U.gerenteA, { imagem: grande }).expect(413);
      expect(extrator).not.toHaveBeenCalled();
      await naoGravouNada();
    });

    it('aceita JPEG, PNG e WebP com MIME coerente', async () => {
      await enviar(U.gerenteA, { imagem: jpeg(1), mime: 'image/jpeg' }).expect(200);
      await enviar(U.gerenteA, { imagem: png(2), mime: 'image/png', nome: 'a.png' }).expect(200);
      await enviar(U.gerenteA, { imagem: webp(3), mime: 'image/webp', nome: 'a.webp' }).expect(200);
      expect(extrator.mock.calls.map((c) => c[1])).toEqual(['image/jpeg', 'image/png', 'image/webp']);
      await naoGravouNada();
    });

    it('415 quando o MIME declarado difere da assinatura real (PNG declarado como JPEG)', async () => {
      await enviar(U.gerenteA, { imagem: png(), mime: 'image/jpeg' }).expect(415);
      expect(extrator).not.toHaveBeenCalled();
      await naoGravouNada();
    });

    it('415 para conteúdo que não é imagem mesmo declarado image/jpeg (script/HTML)', async () => {
      await enviar(U.gerenteA, { imagem: Buffer.from('<script>alert(1)</script>'), mime: 'image/jpeg' }).expect(415);
      await naoGravouNada();
    });

    it('415 para tipo não suportado (GIF, PDF)', async () => {
      await enviar(U.gerenteA, { imagem: Buffer.from('GIF89a......'), mime: 'image/gif', nome: 'a.gif' }).expect(415);
      await enviar(U.gerenteA, { imagem: Buffer.from('%PDF-1.4 ...'), mime: 'application/pdf', nome: 'a.pdf' }).expect(415);
      expect(extrator).not.toHaveBeenCalled();
    });
  });

  describe('resposta e efeito no banco/disco', () => {
    it('boleto com linha válida: sugere Boleto, devolve o hash_sha256 da imagem e NÃO grava anexo nem objeto', async () => {
      const imagem = jpeg(10);
      const res = await enviar(U.gerenteA, { imagem }).expect(200);
      expect(res.body).toMatchObject({
        hash_sha256: sha(imagem),
        tipo_documento: 'boleto',
        tipo_sugerido: 'Boleto',
        fornecedor: 'Distribuidora Sol',
        valor: 321.45,
        dt_vencimento: '2026-11-10',
        dt_recebimento: '2026-10-21',
        linha_digitavel: LINHA,
        campos_nao_lidos: [],
        avisos: []
      });
      expect(res.body).not.toHaveProperty('anexo_id');
      expect(extrator).toHaveBeenCalledTimes(1);
      expect(extrator.mock.calls[0][1]).toBe('image/jpeg');
      expect(extrator.mock.calls[0][0].equals(imagem)).toBe(true);
      await naoGravouNada();
    });

    it('a leitura não cria boleto algum', async () => {
      await enviar(U.gerenteA).expect(200);
      expect(Number((await env.um('SELECT count(*) AS n FROM boletos_notas')).n)).toBe(2);
    });

    it('campos não lidos são listados quando o modelo devolve null', async () => {
      extrator.mockResolvedValue(extracaoBoleto({ fornecedor: null, valor: null, dt_vencimento: null, dt_documento: null }));
      const res = await enviar(U.gerenteA).expect(200);
      expect(res.body.campos_nao_lidos).toEqual(['fornecedor', 'valor', 'dt_vencimento', 'dt_recebimento']);
      expect(res.body.tipo_sugerido).toBe('Boleto');
    });

    it('sem linha digitável válida NÃO sugere Boleto (tipo_sugerido null) e avisa', async () => {
      const l = LINHA.slice(0, 46) + String((Number(LINHA[46]) + 1) % 10);
      extrator.mockResolvedValue(extracaoBoleto({ linha_digitavel: l }));
      const res = await enviar(U.gerenteA).expect(200);
      expect(res.body.tipo_sugerido).toBeNull();
      expect(res.body.linha_digitavel).toBeNull();
      expect(res.body.avisos).toContain('Imagem não identificada como boleto.');
      // sem linha válida, vencimento/recebimento não são pré-preenchidos
      expect(res.body.dt_vencimento).toBeNull();
      expect(res.body.dt_recebimento).toBeNull();
    });

    it('documento "outro" sem linha: tipo_sugerido null', async () => {
      extrator.mockResolvedValue({ tipo_documento: 'outro', fornecedor: null, valor: null, dt_vencimento: null, dt_documento: null, linha_digitavel: null });
      const res = await enviar(U.gerenteA).expect(200);
      expect(res.body).toMatchObject({ tipo_documento: 'outro', tipo_sugerido: null });
    });

    it('nota: sugere "Sem Boleto" e não devolve dt_recebimento nem vencimento', async () => {
      extrator.mockResolvedValue({
        tipo_documento: 'nota',
        fornecedor: 'Mercado Bom Preço',
        valor: '89,90',
        dt_vencimento: '2026-11-10',
        dt_documento: '2026-10-21',
        linha_digitavel: null
      });
      const res = await enviar(U.gerenteA).expect(200);
      expect(res.body).toMatchObject({
        tipo_documento: 'nota',
        tipo_sugerido: 'Sem Boleto',
        fornecedor: 'Mercado Bom Preço',
        valor: 89.9,
        dt_vencimento: null,
        dt_recebimento: null,
        linha_digitavel: null,
        campos_nao_lidos: [],
        avisos: []
      });
    });

    it('saída suja do modelo é saneada (valor negativo, data impossível, tipo estranho)', async () => {
      extrator.mockResolvedValue({
        tipo_documento: 'fatura??',
        fornecedor: 'X'.repeat(500),
        valor: -10,
        dt_vencimento: '2026-02-31',
        dt_documento: 'ontem',
        linha_digitavel: '123'
      });
      const res = await enviar(U.gerenteA).expect(200);
      expect(res.body.tipo_documento).toBe('outro');
      expect(res.body.tipo_sugerido).toBeNull();
      expect(res.body.valor).toBeNull();
      expect(res.body.fornecedor).toHaveLength(200);
      expect(res.body.dt_vencimento).toBeNull();
    });

    it('502 quando a IA falha, sem vazar a causa e sem gravar nada', async () => {
      extrator.mockRejectedValue(new GeminiErro('A IA respondeu com status 500 chave=SEGREDO', true));
      const res = await enviar(U.gerenteA).expect(502);
      expect(JSON.stringify(res.body)).not.toMatch(/SEGREDO|status 500/);
      await naoGravouNada();
    });

    it('502 também para erro inesperado do extrator', async () => {
      extrator.mockRejectedValue(new Error('boom'));
      await enviar(U.gerenteA).expect(502);
    });
  });

  describe('imagem repetida', () => {
    /** Fluxo real: lê, cria o boleto e anexa a imagem (storage fake). Devolve o boleto criado. */
    async function cadastrarComImagem(usuario, imagem, { rid = 1, linha = LINHA } = {}) {
      const lido = await enviar(usuario, { rid, imagem }).expect(200);
      const criado = await request(env.app)
        .post('/api/boletos')
        .set(auth(usuario))
        .send({ restaurante_id: rid, descricao: 'Descr-Secreta-XYZ', valor: 10, tipo: 'Boleto', dt_recebimento: '2026-10-20', dt_vencimento: '2026-11-10', linha_digitavel: linha })
        .expect(201);
      await request(env.app)
        .post(`/api/boletos/${criado.body.id}/anexo`)
        .set(auth(usuario))
        .field('hash_sha256', lido.body.hash_sha256)
        .attach('imagem', imagem, { filename: 'a.jpg', contentType: 'image/jpeg' })
        .expect(201);
      extrator.mockClear();
      return criado.body;
    }

    it('ler a mesma imagem várias vezes SEM cadastrar não é "repetida": lê de novo, sem anexo', async () => {
      const a = await enviar(U.gerenteA, { imagem: jpeg(5) }).expect(200);
      const b = await enviar(U.gerenteA, { imagem: jpeg(5) }).expect(200);
      expect(b.body.hash_sha256).toBe(a.body.hash_sha256);
      expect(b.body.aviso_imagem_repetida).toBeUndefined();
      expect(extrator).toHaveBeenCalledTimes(2);
      await naoGravouNada();
    });

    it('imagem já anexada a um boleto: avisa sem chamar a IA nem contar no teto; forcar_repetida lê de novo', async () => {
      const boleto = await cadastrarComImagem(U.gerenteA, jpeg(6));
      const usoAntes = await env.um('SELECT total FROM boletos_extracoes_uso WHERE usuario_id = 2');

      const repetida = await enviar(U.gerenteA, { imagem: jpeg(6) }).expect(200);
      expect(repetida.body.hash_sha256).toBe(sha(jpeg(6)));
      expect(repetida.body.tipo_sugerido).toBeNull();
      expect(repetida.body.aviso_imagem_repetida).toMatchObject({ id: boleto.id, restaurante_id: 1, linha_digitavel: LINHA });
      expect(repetida.body.avisos[0]).toMatch(/já foi cadastrada/);
      expect(extrator).not.toHaveBeenCalled();
      expect((await env.um('SELECT total FROM boletos_extracoes_uso WHERE usuario_id = 2')).total).toBe(usoAntes.total);

      const forcada = await enviar(U.gerenteA, { imagem: jpeg(6), extra: { forcar_repetida: 'true' } }).expect(200);
      expect(extrator).toHaveBeenCalledTimes(1);
      expect(forcada.body.tipo_sugerido).toBe('Boleto');
      expect(forcada.body.aviso_imagem_repetida).toBeUndefined();
      expect((await env.um('SELECT total FROM boletos_extracoes_uso WHERE usuario_id = 2')).total).toBe(usoAntes.total + 1);
      expect(await contarAnexos()).toBe(1);
    });

    it('forcar_repetida=1 também vale; qualquer outro valor não', async () => {
      await cadastrarComImagem(U.gerenteA, jpeg(7));
      await enviar(U.gerenteA, { imagem: jpeg(7), extra: { forcar_repetida: 'sim' } }).expect(200);
      expect(extrator).not.toHaveBeenCalled();
      await enviar(U.gerenteA, { imagem: jpeg(7), extra: { forcar_repetida: '1' } }).expect(200);
      expect(extrator).toHaveBeenCalledTimes(1);
    });

    it('a repetição vale só dentro do restaurante: outro restaurante lê normalmente', async () => {
      await cadastrarComImagem(U.gerenteA, jpeg(8));
      const outro = await enviar(U.gerenteB, { rid: 2, imagem: jpeg(8) }).expect(200);
      expect(extrator).toHaveBeenCalledTimes(1);
      expect(outro.body.aviso_imagem_repetida).toBeUndefined();
    });

    it('aviso de repetida não vaza boleto de outro restaurante', async () => {
      await cadastrarComImagem(U.gerenteA, jpeg(9));
      const res = await enviar(U.gerenteB, { rid: 2, imagem: jpeg(9) }).expect(200);
      expect(JSON.stringify(res.body)).not.toContain('Fornecedor A');
      expect(JSON.stringify(res.body)).not.toContain('Descr-Secreta-XYZ');
    });

    it('imagem cujo boleto foi excluído (soft delete) deixa de ser "repetida"', async () => {
      const boleto = await cadastrarComImagem(U.gerenteA, jpeg(11));
      await env.rows('UPDATE boletos_notas SET deleted_at = now() WHERE id = $1', [boleto.id]);
      const res = await enviar(U.gerenteA, { imagem: jpeg(11) }).expect(200);
      expect(extrator).toHaveBeenCalledTimes(1);
      expect(res.body.aviso_imagem_repetida).toBeUndefined();
    });

    it('imagem anexada por OUTRO usuário do mesmo restaurante também é repetida (a regra é por restaurante)', async () => {
      await cadastrarComImagem(U.admin, jpeg(12));
      const res = await enviar(U.gerenteA, { imagem: jpeg(12) }).expect(200);
      expect(res.body.aviso_imagem_repetida).toBeTruthy();
      expect(extrator).not.toHaveBeenCalled();
    });
  });

  describe('rate limit', () => {
    it('429 com Retry-After depois de 10 leituras por minuto; reset libera', async () => {
      const max = Number(process.env.EXTRAIR_RATE_LIMIT_MAX) || 10;
      for (let i = 0; i < max; i++) {
        await enviar(U.gerenteA, { imagem: jpeg(100 + i) }).expect(200);
      }
      const res = await enviar(U.gerenteA, { imagem: jpeg(999) }).expect(429);
      expect(Number(res.headers['retry-after'])).toBeGreaterThanOrEqual(1);
      expect(extrator).toHaveBeenCalledTimes(max);
      // outro usuário não é afetado
      await enviar(U.admin, { imagem: jpeg(998) }).expect(200);
      extrairRateLimit.reset();
      await enviar(U.gerenteA, { imagem: jpeg(997) }).expect(200);
    });

    // Sem exposedHeaders o navegador não entrega Retry-After ao JS com front e API em hosts diferentes.
    it('o 429 expõe Retry-After via CORS (Access-Control-Expose-Headers)', async () => {
      const max = Number(process.env.EXTRAIR_RATE_LIMIT_MAX) || 10;
      for (let i = 0; i < max; i++) {
        await enviar(U.gerenteA, { imagem: jpeg(200 + i) }).set('Origin', 'https://app.exemplo.com').expect(200);
      }
      const res = await enviar(U.gerenteA, { imagem: jpeg(996) }).set('Origin', 'https://app.exemplo.com').expect(429);
      expect(res.headers['access-control-expose-headers'] || '').toMatch(/retry-after/i);
    });
  });
});
