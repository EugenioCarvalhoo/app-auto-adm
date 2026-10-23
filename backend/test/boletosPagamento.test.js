/**
 * Baixa de pagamento (POST/DELETE /api/boletos/:id/pago), imagem do boleto (GET /anexo),
 * ocorrências do admin e a flag pode_marcar_pago. Postgres real.
 */
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { usarBancoReal, auth, U, JWT_SECRET } = require('./helpers/setup');
const { linha47 } = require('./helpers/linhas');
const { jpeg, png } = require('./helpers/imagens');
const { definirStorage } = require('../lib/storage');
const { criarStorageFake } = require('./helpers/storageFake');

const env = usarBancoReal();

const pagar = (usuario, id) => request(env.app).post(`/api/boletos/${id}/pago`).set(auth(usuario));
const desfazer = (usuario, id, motivo) => {
  const r = request(env.app).delete(`/api/boletos/${id}/pago`).set(auth(usuario));
  return motivo === undefined ? r : r.send({ motivo });
};
const darFlag = (id, valor = true) => env.rows('UPDATE usuarios SET pode_marcar_pago = $2 WHERE id = $1', [id, valor]);
const estado = (id) =>
  env.um(
    `SELECT pago, pago_em, pago_por_usuario_id, pagamento_desfeito_em, pagamento_desfeito_por_usuario_id, pagamento_desfeito_motivo
     FROM boletos_notas WHERE id = $1`,
    [id]
  );

describe('pagamento de boletos', () => {
  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  describe('marcar como pago', () => {
    it('401 sem token', async () => {
      await request(env.app).post('/api/boletos/10/pago').expect(401);
    });

    it('usuário sem a flag pode_marcar_pago => 403 e nada muda', async () => {
      const res = await pagar(U.gerenteA, 10).expect(403);
      expect(res.body.error).toMatch(/Sem permissão/);
      expect((await estado(10)).pago).toBe(false);
    });

    it('usuário COM a flag e vinculado ao restaurante marca; grava quem e quando', async () => {
      await darFlag(2);
      const res = await pagar(U.gerenteA, 10).expect(200);
      expect(res.body).toMatchObject({ id: 10, pago: true, pago_por_usuario_id: 2 });
      const e = await estado(10);
      expect(e.pago).toBe(true);
      expect(e.pago_em).toBeInstanceOf(Date);
      expect(e.pago_por_usuario_id).toBe(2);
    });

    it('admin marca sem precisar da flag', async () => {
      await pagar(U.admin, 20).expect(200);
      expect((await estado(20)).pago_por_usuario_id).toBe(1);
    });

    it('COM a flag mas SEM vínculo com o restaurante do boleto => 403 (restaurante alheio)', async () => {
      await darFlag(2);
      await pagar(U.gerenteA, 20).expect(403);
      expect((await estado(20)).pago).toBe(false);
      await darFlag(5);
      await pagar(U.semVinculo, 10).expect(403);
      expect((await estado(10)).pago).toBe(false);
    });

    it('flag sem o módulo de boletos => 403', async () => {
      await darFlag(4);
      await pagar(U.semModulo, 10).expect(403);
      expect((await estado(10)).pago).toBe(false);
    });

    it('a flag é lida do banco: remover vale mesmo com token antigo', async () => {
      await darFlag(2);
      const headers = auth(U.gerenteA);
      await darFlag(2, false);
      await request(env.app).post('/api/boletos/10/pago').set(headers).expect(403);
    });

    it('token com pode_marcar_pago=true forjado no payload não vale (assinatura inválida)', async () => {
      const forjado = jwt.sign({ id: 2, username: 'gerenteA', is_admin: false, pode_marcar_pago: true }, 'chave_errada');
      await request(env.app).post('/api/boletos/10/pago').set('Authorization', `Bearer ${forjado}`).expect(403);
      // e com a assinatura certa, o payload também é ignorado
      const assinado = jwt.sign({ id: 2, username: 'gerenteA', is_admin: false, pode_marcar_pago: true }, JWT_SECRET);
      await request(env.app).post('/api/boletos/10/pago').set('Authorization', `Bearer ${assinado}`).expect(403);
      expect((await estado(10)).pago).toBe(false);
    });

    it('já pago => 409 e não regrava pago_em', async () => {
      await pagar(U.admin, 10).expect(200);
      const antes = await estado(10);
      const res = await pagar(U.admin, 10).expect(409);
      expect(res.body.error).toMatch(/já está marcado/);
      expect(await estado(10)).toEqual(antes);
    });

    it('404 inexistente; 400 id inválido', async () => {
      await pagar(U.admin, 9999).expect(404);
      await pagar(U.admin, 'abc').expect(400);
    });

    it('a listagem reflete o pagamento', async () => {
      await pagar(U.admin, 10).expect(200);
      const lista = await request(env.app).get('/api/boletos?restaurante_id=1').set(auth(U.gerenteA)).expect(200);
      expect(lista.body.find((b) => b.id === 10)).toMatchObject({ pago: true });
    });
  });

  describe('desfazer pagamento', () => {
    beforeEach(() => pagar(U.admin, 10).expect(200));

    it('apenas admin: usuário com pode_marcar_pago NÃO desfaz (403) e o pagamento permanece', async () => {
      await darFlag(2);
      const res = await desfazer(U.gerenteA, 10, 'motivo bem válido').expect(403);
      expect(res.body.error).toMatch(/administradores/);
      expect((await estado(10)).pago).toBe(true);
    });

    it('restaurante alheio => 403 mesmo para quem tem a flag', async () => {
      await darFlag(3);
      await desfazer(U.gerenteB, 10, 'motivo bem válido').expect(403);
      expect((await estado(10)).pago).toBe(true);
    });

    it.each([[undefined], [''], ['abcd'], ['    abc  ']])('motivo ausente/curto (%p) => 400 e continua pago', async (motivo) => {
      await desfazer(U.admin, 10, motivo).expect(400);
      expect((await estado(10)).pago).toBe(true);
    });

    it('motivo acima de 500 caracteres => 400', async () => {
      await desfazer(U.admin, 10, 'x'.repeat(501)).expect(400);
      expect((await estado(10)).pago).toBe(true);
    });

    it('com motivo válido: limpa o pagamento e registra quem, quando e por quê', async () => {
      const res = await desfazer(U.admin, 10, '  Pago em duplicidade  ').expect(200);
      expect(res.body).toMatchObject({ id: 10, pago: false });
      const e = await estado(10);
      expect(e).toMatchObject({
        pago: false,
        pago_em: null,
        pago_por_usuario_id: null,
        pagamento_desfeito_por_usuario_id: 1,
        pagamento_desfeito_motivo: 'Pago em duplicidade'
      });
      expect(e.pagamento_desfeito_em).toBeInstanceOf(Date);
    });

    it('motivo que não é texto (objeto) => 400', async () => {
      await desfazer(U.admin, 10, { a: 1 }).expect(400);
      expect((await estado(10)).pago).toBe(true);
    });

    it('não estava pago => 409', async () => {
      await desfazer(U.admin, 20, 'motivo bem válido').expect(409);
      expect((await estado(20)).pagamento_desfeito_motivo).toBeNull();
    });

    it('depois de desfazer é possível pagar de novo', async () => {
      await desfazer(U.admin, 10, 'motivo bem válido').expect(200);
      await pagar(U.admin, 10).expect(200);
      expect((await estado(10)).pago).toBe(true);
    });
  });
});

describe('GET /api/boletos/:id/anexo', () => {
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

  async function anexar(boletoId, restauranteId, imagem, mime) {
    const chave = await storage.salvar(restauranteId, imagem, mime === 'image/png' ? 'png' : 'jpg');
    await env.rows(
      `INSERT INTO boletos_anexos (boleto_id, restaurante_id, usuario_id, storage_chave, mime, tamanho_bytes, hash_sha256)
       VALUES ($1, $2, 2, $3, $4, $5, $6)`,
      [boletoId, restauranteId, chave, mime, imagem.length, 'b'.repeat(64)]
    );
    return chave;
  }

  it('401 sem token', async () => {
    await request(env.app).get('/api/boletos/10/anexo').expect(401);
  });

  it('serve a imagem com Content-Type correto e cabeçalhos de segurança', async () => {
    const img = jpeg(1);
    await anexar(10, 1, img, 'image/jpeg');
    const res = await request(env.app).get('/api/boletos/10/anexo').set(auth(U.gerenteA)).buffer(true).parse((r, cb) => {
      const partes = [];
      r.on('data', (c) => partes.push(c));
      r.on('end', () => cb(null, Buffer.concat(partes)));
    }).expect(200);
    expect(res.headers['content-type']).toBe('image/jpeg');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-disposition']).toBe('inline');
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
    expect(res.headers['cache-control']).toBe('private, max-age=300');
    expect(Number(res.headers['content-length'])).toBe(img.length);
    expect(res.body.equals(img)).toBe(true);
  });

  it('serve PNG com image/png', async () => {
    await anexar(10, 1, png(1), 'image/png');
    const res = await request(env.app).get('/api/boletos/10/anexo').set(auth(U.admin)).expect(200);
    expect(res.headers['content-type']).toBe('image/png');
  });

  it('403 para usuário de outro restaurante (IDOR) e para quem não tem módulo', async () => {
    await anexar(10, 1, jpeg(2), 'image/jpeg');
    await request(env.app).get('/api/boletos/10/anexo').set(auth(U.gerenteB)).expect(403);
    await request(env.app).get('/api/boletos/10/anexo').set(auth(U.semVinculo)).expect(403);
    await request(env.app).get('/api/boletos/10/anexo').set(auth(U.semModulo)).expect(403);
  });

  it('o 403 não revela o conteúdo da imagem', async () => {
    await anexar(10, 1, jpeg(3), 'image/jpeg');
    const res = await request(env.app).get('/api/boletos/10/anexo').set(auth(U.gerenteB)).expect(403);
    expect(res.headers['content-type']).toMatch(/json/);
  });

  it('404 sem imagem, boleto inexistente; 400 id inválido', async () => {
    await request(env.app).get('/api/boletos/10/anexo').set(auth(U.gerenteA)).expect(404);
    await request(env.app).get('/api/boletos/9999/anexo').set(auth(U.admin)).expect(404);
    await request(env.app).get('/api/boletos/abc/anexo').set(auth(U.admin)).expect(400);
  });

  it('404 quando o arquivo sumiu do storage', async () => {
    const chave = await anexar(10, 1, jpeg(4), 'image/jpeg');
    storage.objetos.delete(chave);
    const res = await request(env.app).get('/api/boletos/10/anexo').set(auth(U.gerenteA)).expect(404);
    expect(res.body.error).toMatch(/não encontrada/);
  });

  it('404 (e não 500) quando o storage falha ao ler, sem vazar o erro interno', async () => {
    await anexar(10, 1, jpeg(4), 'image/jpeg');
    storage.falhar.ler = new Error('connect ECONNREFUSED 10.0.0.9:9000 chave=SEGREDO');
    const res = await request(env.app).get('/api/boletos/10/anexo').set(auth(U.gerenteA)).expect(404);
    expect(JSON.stringify(res.body)).not.toMatch(/ECONNREFUSED|SEGREDO|10\.0\.0\.9/);
  });

  it('503 quando há imagem no banco mas o storage não está configurado; sem imagem continua 404', async () => {
    await anexar(10, 1, jpeg(4), 'image/jpeg');
    definirStorage(null);
    const chaves = ['STORAGE_ENDPOINT', 'STORAGE_BUCKET', 'STORAGE_ACCESS_KEY', 'STORAGE_SECRET_KEY'];
    const guardado = Object.fromEntries(chaves.map((k) => [k, process.env[k]]));
    chaves.forEach((k) => delete process.env[k]);
    try {
      const res = await request(env.app).get('/api/boletos/10/anexo').set(auth(U.gerenteA)).expect(503);
      expect(res.body.error).toMatch(/não configurado/);
      await request(env.app).get('/api/boletos/20/anexo').set(auth(U.admin)).expect(404);
    } finally {
      chaves.forEach((k) => {
        if (guardado[k] !== undefined) process.env[k] = guardado[k];
      });
    }
  });

  it('serve o Content-Type do banco (validado), não o que o storage devolve', async () => {
    const chave = await anexar(10, 1, jpeg(4), 'image/jpeg');
    storage.objetos.get(chave).mime = 'text/html';
    const res = await request(env.app).get('/api/boletos/10/anexo').set(auth(U.gerenteA)).expect(200);
    expect(res.headers['content-type']).toBe('image/jpeg');
  });

  it('boleto excluído (soft delete): 404 mesmo para o admin', async () => {
    await anexar(10, 1, jpeg(4), 'image/jpeg');
    await env.rows('UPDATE boletos_notas SET deleted_at = now() WHERE id = 10');
    await request(env.app).get('/api/boletos/10/anexo').set(auth(U.admin)).expect(404);
  });

  it('404 quando a chave no banco é maliciosa (path traversal): o storage recusa e nada é devolvido', async () => {
    storage.objetos.set('segredo', { conteudo: Buffer.from('segredo'), mime: 'image/jpeg' });
    await env.rows(
      `INSERT INTO boletos_anexos (boleto_id, restaurante_id, usuario_id, storage_chave, mime, tamanho_bytes, hash_sha256)
       VALUES (10, 1, 2, $1, 'image/jpeg', 7, $2)`,
      ['../segredo.jpg', 'c'.repeat(64)]
    );
    const res = await request(env.app).get('/api/boletos/10/anexo').set(auth(U.gerenteA)).expect(404);
    expect(JSON.stringify(res.body)).not.toContain('segredo');
  });

  it('404 quando o MIME gravado não é de imagem permitida (nunca serve text/html)', async () => {
    const chave = await storage.salvar(1, jpeg(5), 'jpg');
    await env.rows(
      `INSERT INTO boletos_anexos (boleto_id, restaurante_id, usuario_id, storage_chave, mime, tamanho_bytes, hash_sha256)
       VALUES (10, 1, 2, $1, 'text/html', 5, $2)`,
      [chave, 'd'.repeat(64)]
    );
    await request(env.app).get('/api/boletos/10/anexo').set(auth(U.gerenteA)).expect(404);
  });

  it('anexo gravado com outro restaurante_id que o do boleto não é servido', async () => {
    await anexar(10, 2, jpeg(6), 'image/jpeg');
    await request(env.app).get('/api/boletos/10/anexo').set(auth(U.admin)).expect(404);
  });

  it('o banco impede dois anexos no mesmo boleto (índice único uq_boletos_anexos_boleto)', async () => {
    await anexar(10, 1, jpeg(7), 'image/jpeg');
    await expect(anexar(10, 1, png(8), 'image/png')).rejects.toMatchObject({ code: '23505', constraint: 'uq_boletos_anexos_boleto' });
    expect(Number((await env.um('SELECT count(*) AS n FROM boletos_anexos WHERE boleto_id = 10')).n)).toBe(1);
  });
});

describe('ocorrências de boletos (admin)', () => {
  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  const LINHA = linha47(1);
  async function gerarOcorrencia() {
    await request(env.app)
      .post('/api/boletos')
      .set(auth(U.gerenteB))
      .send({ restaurante_id: 2, descricao: 'Orig', valor: 1, tipo: 'Boleto', dt_recebimento: '2026-10-20', dt_vencimento: '2026-11-05', fornecedor: 'Forn B', linha_digitavel: LINHA })
      .expect(201);
    await request(env.app)
      .post('/api/boletos')
      .set(auth(U.gerenteA))
      .send({ restaurante_id: 1, descricao: 'Dup', valor: 1, tipo: 'Boleto', dt_recebimento: '2026-10-20', dt_vencimento: '2026-11-05', linha_digitavel: LINHA })
      .expect(409);
    return (await env.um('SELECT id FROM boletos_ocorrencias ORDER BY id DESC LIMIT 1')).id;
  }

  it('401 sem token; 403 para usuário comum em ambas as rotas', async () => {
    await request(env.app).get('/api/admin/boletos-ocorrencias').expect(401);
    await request(env.app).get('/api/admin/boletos-ocorrencias').set(auth(U.gerenteA)).expect(403);
    await request(env.app).post('/api/admin/boletos-ocorrencias/1/visto').set(auth(U.gerenteA)).expect(403);
  });

  it('403 também para quem tem pode_marcar_pago (flag não dá poder de admin)', async () => {
    await darFlag(2);
    await request(env.app).get('/api/admin/boletos-ocorrencias').set(auth(U.gerenteA)).expect(403);
  });

  it('lista as não vistas com usuário, restaurante e o boleto existente', async () => {
    const id = await gerarOcorrencia();
    const res = await request(env.app).get('/api/admin/boletos-ocorrencias').set(auth(U.admin)).expect(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({
      id,
      tipo: 'linha_duplicada',
      usuario_id: 2,
      usuario_username: 'gerenteA',
      restaurante_id: 1,
      restaurante_nome: 'Restaurante A',
      boleto_existente_restaurante_id: 2,
      boleto_existente_restaurante_nome: 'Restaurante B',
      boleto_existente_fornecedor: 'Forn B',
      linha_digitavel: LINHA,
      visto_em: null
    });
  });

  it('marcar como vista tira da lista padrão; ?todas=1 ainda mostra, com quem viu', async () => {
    const id = await gerarOcorrencia();
    const vista = await request(env.app).post(`/api/admin/boletos-ocorrencias/${id}/visto`).set(auth(U.admin)).expect(200);
    expect(vista.body).toMatchObject({ id, visto_por_usuario_id: 1 });
    expect(vista.body.visto_em).toBeTruthy();
    expect((await request(env.app).get('/api/admin/boletos-ocorrencias').set(auth(U.admin)).expect(200)).body).toEqual([]);
    const todas = await request(env.app).get('/api/admin/boletos-ocorrencias?todas=1').set(auth(U.admin)).expect(200);
    expect(todas.body).toHaveLength(1);
    expect(todas.body[0].visto_por_usuario_id).toBe(1);
  });

  it('visto é idempotente: repetir (inclusive por outro admin) não muda quando nem quem viu', async () => {
    const id = await gerarOcorrencia();
    await env.rows(
      `INSERT INTO usuarios (id, username, password, nome, is_admin, modulo_boletos) VALUES (50, 'admin2', 'x', 'Admin 2', true, true)`
    );
    await request(env.app).post(`/api/admin/boletos-ocorrencias/${id}/visto`).set(auth(U.admin)).expect(200);
    const primeira = await env.um('SELECT visto_em, visto_por_usuario_id FROM boletos_ocorrencias WHERE id = $1', [id]);
    await request(env.app)
      .post(`/api/admin/boletos-ocorrencias/${id}/visto`)
      .set(auth({ id: 50, username: 'admin2', is_admin: true }))
      .expect(200);
    const segunda = await env.um('SELECT visto_em, visto_por_usuario_id FROM boletos_ocorrencias WHERE id = $1', [id]);
    expect(segunda).toEqual(primeira);
    expect(segunda.visto_por_usuario_id).toBe(1);
  });

  it('404 para ocorrência inexistente; 400 para id inválido', async () => {
    await request(env.app).post('/api/admin/boletos-ocorrencias/9999/visto').set(auth(U.admin)).expect(404);
    await request(env.app).post('/api/admin/boletos-ocorrencias/abc/visto').set(auth(U.admin)).expect(400);
  });

  it('a ocorrência sobrevive à remoção definitiva do boleto existente (boleto_existente_id vira NULL)', async () => {
    const id = await gerarOcorrencia();
    await env.rows('DELETE FROM boletos_notas WHERE restaurante_id = 2 AND linha_digitavel = $1', [LINHA]);
    const o = await env.um('SELECT boleto_existente_id FROM boletos_ocorrencias WHERE id = $1', [id]);
    expect(o.boleto_existente_id).toBeNull();
    const res = await request(env.app).get('/api/admin/boletos-ocorrencias').set(auth(U.admin)).expect(200);
    expect(res.body).toHaveLength(1);
  });
});
