/**
 * POST/PUT de boleto com linha digitável, fornecedor, similaridade, anexo e soft delete (Postgres real).
 * A unicidade da linha é GLOBAL (todos os restaurantes) e a resposta nunca vaza dados do boleto existente.
 */
const request = require('supertest');
const { usarBancoReal, auth, U } = require('./helpers/setup');
const { linha47, linha48, corromper } = require('./helpers/linhas');

const env = usarBancoReal();

const L1 = linha47(1);
const L2 = linha47(2);
const L3 = linha47(3);

const boletoValido = (extra = {}) => ({
  restaurante_id: 1,
  descricao: 'Hortifruti',
  valor: '150,75',
  tipo: 'Boleto',
  dt_recebimento: '2026-10-20',
  dt_vencimento: '2026-11-05',
  ...extra
});

const post = (usuario, corpo) => request(env.app).post('/api/boletos').set(auth(usuario)).send(corpo);
const put = (usuario, id, corpo) => request(env.app).put(`/api/boletos/${id}`).set(auth(usuario)).send(corpo);
const contarBoletos = async () => Number((await env.um('SELECT count(*) AS n FROM boletos_notas')).n);
const ocorrencias = () => env.rows('SELECT * FROM boletos_ocorrencias ORDER BY id');

/** Insere um anexo órfão direto no banco (como se já tivesse passado pelo /extrair). */
async function criarAnexo({ usuario_id, restaurante_id = 1, boleto_id = null, hash = 'a'.repeat(64) } = {}) {
  const r = await env.um(
    `INSERT INTO boletos_anexos (boleto_id, restaurante_id, usuario_id, storage_chave, mime, tamanho_bytes, hash_sha256)
     VALUES ($1, $2, $3, $4, 'image/jpeg', 10, $5) RETURNING id`,
    [boleto_id, restaurante_id, usuario_id, `${restaurante_id}/${'c'.repeat(32)}.jpg`, hash]
  );
  return r.id;
}

describe('boletos: linha digitável, similaridade, anexo e soft delete', () => {
  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  describe('linha digitável no POST', () => {
    it('grava só os dígitos (aceita máscara) e devolve a linha', async () => {
      const mascarada = '00190.50095 40144.816069 06809.350314 3 37370000000100';
      const res = await post(U.gerenteA, boletoValido({ linha_digitavel: mascarada })).expect(201);
      expect(res.body.linha_digitavel).toBe('00190500954014481606906809350314337370000000100');
      expect((await env.um('SELECT linha_digitavel FROM boletos_notas WHERE id = $1', [res.body.id])).linha_digitavel).toBe(
        '00190500954014481606906809350314337370000000100'
      );
    });

    it('aceita linha de 48 dígitos', async () => {
      await post(U.gerenteA, boletoValido({ linha_digitavel: linha48(1, 10) })).expect(201);
    });

    it.each([
      ['DV errado', corromper(L1)],
      ['tamanho errado', '1234567890'],
      ['letras', 'abc']
    ])('linha inválida (%s) => 400 e nada gravado', async (_n, linha_digitavel) => {
      await post(U.gerenteA, boletoValido({ linha_digitavel })).expect(400);
      expect(await contarBoletos()).toBe(2);
    });

    it('linha vazia ou ausente é permitida (campo opcional)', async () => {
      await post(U.gerenteA, boletoValido({ linha_digitavel: '' })).expect(201);
      await post(U.gerenteA, boletoValido({ descricao: 'Outro', linha_digitavel: null })).expect(201);
      const n = await env.um('SELECT count(*) AS n FROM boletos_notas WHERE linha_digitavel IS NULL');
      expect(Number(n.n)).toBe(4);
    });

    it('"Sem Boleto" ignora a linha enviada (grava null)', async () => {
      const res = await post(U.gerenteA, boletoValido({ tipo: 'Sem Boleto', linha_digitavel: L1 })).expect(201);
      expect((await env.um('SELECT linha_digitavel FROM boletos_notas WHERE id = $1', [res.body.id])).linha_digitavel).toBeNull();
    });

    it('fornecedor é saneado e o normalizado é gravado', async () => {
      const res = await post(U.gerenteA, boletoValido({ fornecedor: '  AÇOUGUE\u0000   Bom  ' })).expect(201);
      const row = await env.um('SELECT fornecedor, fornecedor_norm FROM boletos_notas WHERE id = $1', [res.body.id]);
      expect(row).toEqual({ fornecedor: 'AÇOUGUE Bom', fornecedor_norm: 'acougue bom' });
    });
  });

  describe('entradas de tipo errado', () => {
    it.each([
      ['número', 123],
      ['array', ['a']],
      ['objeto', { a: 1 }]
    ])('fornecedor %s => 400 no POST e nada gravado', async (_n, fornecedor) => {
      const antes = await contarBoletos();
      const res = await post(U.gerenteA, boletoValido({ fornecedor })).expect(400);
      expect(res.body.error).toMatch(/Fornecedor inválido/);
      expect(await contarBoletos()).toBe(antes);
    });

    it.each([
      ['número', 123],
      ['array', ['a']],
      ['objeto', { a: 1 }]
    ])('fornecedor %s => 400 no PUT e o registro não muda', async (_n, fornecedor) => {
      const criado = await post(U.gerenteA, boletoValido({ fornecedor: 'Original' })).expect(201);
      await put(U.gerenteA, criado.body.id, { fornecedor }).expect(400);
      const row = await env.um('SELECT fornecedor FROM boletos_notas WHERE id = $1', [criado.body.id]);
      expect(row.fornecedor).toBe('Original');
    });

    it('fornecedor null e string vazia continuam válidos (POST e PUT)', async () => {
      const a = await post(U.gerenteA, boletoValido({ fornecedor: null })).expect(201);
      const b = await post(U.gerenteA, boletoValido({ descricao: 'B', fornecedor: '' })).expect(201);
      expect((await env.um('SELECT fornecedor FROM boletos_notas WHERE id = $1', [a.body.id])).fornecedor).toBeNull();
      const antesB = await env.um('SELECT fornecedor FROM boletos_notas WHERE id = $1', [b.body.id]);
      expect(antesB.fornecedor == null || antesB.fornecedor === '').toBe(true);
      const c = await post(U.gerenteA, boletoValido({ descricao: 'C', fornecedor: 'Algum' })).expect(201);
      await put(U.gerenteA, c.body.id, { fornecedor: null }).expect(200);
      expect((await env.um('SELECT fornecedor FROM boletos_notas WHERE id = $1', [c.body.id])).fornecedor).toBeNull();
      await put(U.gerenteA, c.body.id, { fornecedor: '' }).expect(200);
    });
  });

  describe('linha duplicada (global entre restaurantes)', () => {
    it('409 genérico, sem vazar dados do boleto de outro restaurante, e grava a ocorrência', async () => {
      const original = await post(U.gerenteB, boletoValido({ restaurante_id: 2, fornecedor: 'Fornecedor Secreto B', linha_digitavel: L1 })).expect(201);
      const antes = await contarBoletos();

      const res = await post(U.gerenteA, boletoValido({ linha_digitavel: L1 })).expect(409);
      expect(res.body).toEqual({ error: 'Esta linha digitável já está cadastrada.', codigo: 'LINHA_DUPLICADA' });
      const texto = JSON.stringify(res.body);
      expect(texto).not.toMatch(/Secreto|Restaurante B|restaurante_id|boleto_existente/);
      expect(texto).not.toContain(String(original.body.id) + ',');

      expect(await contarBoletos()).toBe(antes);
      const oc = await ocorrencias();
      expect(oc).toHaveLength(1);
      expect(oc[0]).toMatchObject({
        tipo: 'linha_duplicada',
        usuario_id: 2,
        restaurante_id: 1,
        boleto_existente_id: original.body.id,
        linha_digitavel: L1,
        visto_em: null
      });
    });

    it('duplicada dentro do mesmo restaurante também é 409', async () => {
      await post(U.gerenteA, boletoValido({ linha_digitavel: L1 })).expect(201);
      await post(U.gerenteA, boletoValido({ descricao: 'Outra', linha_digitavel: L1 })).expect(409);
      expect(await ocorrencias()).toHaveLength(1);
    });

    it('a mesma linha com máscara também é detectada', async () => {
      await post(U.gerenteA, boletoValido({ linha_digitavel: '00190500954014481606906809350314337370000000100' })).expect(201);
      await post(U.gerenteB, boletoValido({ restaurante_id: 2, linha_digitavel: '00190.50095 40144.816069 06809.350314 3 37370000000100' })).expect(409);
    });

    it('a ocorrência não depende de similaridade nem de confirmar_similar', async () => {
      await post(U.gerenteA, boletoValido({ linha_digitavel: L1 })).expect(201);
      await post(U.gerenteB, boletoValido({ restaurante_id: 2, linha_digitavel: L1, confirmar_similar: true })).expect(409);
    });

    it('corrida (violação 23505 do índice único) também vira 409 genérico com ocorrência', async () => {
      const existente = await post(U.gerenteB, boletoValido({ restaurante_id: 2, linha_digitavel: L1 })).expect(201);
      // Faz a pré-checagem "não achar" a linha uma vez, simulando outra requisição que insere no meio.
      const original = env.pool.query.bind(env.pool);
      let enganou = false;
      jest.spyOn(env.pool, 'query').mockImplementation((sql, params) => {
        if (!enganou && typeof sql === 'string' && sql.includes('WHERE linha_digitavel = $1')) {
          enganou = true;
          return Promise.resolve({ rows: [], rowCount: 0 });
        }
        return original(sql, params);
      });
      const antes = await contarBoletos();
      const res = await post(U.gerenteA, boletoValido({ linha_digitavel: L1 })).expect(409);
      expect(enganou).toBe(true);
      expect(res.body.codigo).toBe('LINHA_DUPLICADA');
      expect(await contarBoletos()).toBe(antes);
      const oc = await ocorrencias();
      expect(oc).toHaveLength(1);
      expect(oc[0]).toMatchObject({ usuario_id: 2, restaurante_id: 1, boleto_existente_id: existente.body.id, linha_digitavel: L1 });
    });

    it('duas requisições simultâneas com a mesma linha: uma cria, a outra recebe 409; só 1 registro', async () => {
      const [a, b] = await Promise.all([
        post(U.gerenteA, boletoValido({ linha_digitavel: L2 })),
        post(U.gerenteB, boletoValido({ restaurante_id: 2, linha_digitavel: L2 }))
      ]);
      expect([a.status, b.status].sort()).toEqual([201, 409]);
      const n = await env.um('SELECT count(*) AS n FROM boletos_notas WHERE linha_digitavel = $1', [L2]);
      expect(Number(n.n)).toBe(1);
    });

    it('linha de boleto EXCLUÍDO libera o recadastro (inclusive em outro restaurante)', async () => {
      const criado = await post(U.gerenteA, boletoValido({ linha_digitavel: L1 })).expect(201);
      await request(env.app).delete(`/api/boletos/${criado.body.id}`).set(auth(U.gerenteA)).expect(200);
      const novo = await post(U.gerenteB, boletoValido({ restaurante_id: 2, linha_digitavel: L1 })).expect(201);
      expect(novo.body.id).not.toBe(criado.body.id);
      // a linha do excluído continua guardada no registro excluído
      const velho = await env.um('SELECT linha_digitavel, deleted_at FROM boletos_notas WHERE id = $1', [criado.body.id]);
      expect(velho.linha_digitavel).toBe(L1);
      expect(velho.deleted_at).toBeInstanceOf(Date);
      // e agora a nova linha ativa volta a bloquear
      await post(U.gerenteA, boletoValido({ linha_digitavel: L1 })).expect(409);
    });
  });

  describe('PUT com linha digitável', () => {
    it('linha para a qual outro boleto (de outro restaurante) já aponta => 409 genérico + ocorrência; nada muda', async () => {
      await post(U.gerenteB, boletoValido({ restaurante_id: 2, linha_digitavel: L1 })).expect(201);
      const res = await put(U.gerenteA, 10, { linha_digitavel: L1, descricao: 'Mudou' }).expect(409);
      expect(res.body).toEqual({ error: 'Esta linha digitável já está cadastrada.', codigo: 'LINHA_DUPLICADA' });
      const row = await env.um('SELECT linha_digitavel, descricao FROM boletos_notas WHERE id = 10');
      expect(row).toEqual({ linha_digitavel: null, descricao: 'Fornecedor A' });
      const oc = await ocorrencias();
      expect(oc).toHaveLength(1);
      expect(oc[0]).toMatchObject({ usuario_id: 2, restaurante_id: 1, linha_digitavel: L1 });
    });

    it('reenviar a própria linha não é duplicidade', async () => {
      const c = await post(U.gerenteA, boletoValido({ linha_digitavel: L1 })).expect(201);
      await put(U.gerenteA, c.body.id, { linha_digitavel: L1, descricao: 'Ajustado' }).expect(200);
      expect(await ocorrencias()).toHaveLength(0);
    });

    it('troca a linha por outra livre; a antiga fica livre', async () => {
      const c = await post(U.gerenteA, boletoValido({ linha_digitavel: L1 })).expect(201);
      await put(U.gerenteA, c.body.id, { linha_digitavel: L2 }).expect(200);
      await post(U.gerenteB, boletoValido({ restaurante_id: 2, linha_digitavel: L1 })).expect(201);
    });

    it('linha inválida => 400', async () => {
      await put(U.gerenteA, 10, { linha_digitavel: corromper(L1) }).expect(400);
    });

    it('corrida (23505) no PUT também vira 409 genérico', async () => {
      const existente = await post(U.gerenteB, boletoValido({ restaurante_id: 2, linha_digitavel: L3 })).expect(201);
      const original = env.pool.query.bind(env.pool);
      let enganou = false;
      jest.spyOn(env.pool, 'query').mockImplementation((sql, params) => {
        if (!enganou && typeof sql === 'string' && sql.includes('WHERE linha_digitavel = $1')) {
          enganou = true;
          return Promise.resolve({ rows: [], rowCount: 0 });
        }
        return original(sql, params);
      });
      const res = await put(U.gerenteA, 10, { linha_digitavel: L3 }).expect(409);
      expect(res.body.codigo).toBe('LINHA_DUPLICADA');
      expect((await env.um('SELECT linha_digitavel FROM boletos_notas WHERE id = 10')).linha_digitavel).toBeNull();
      const oc = await ocorrencias();
      expect(oc).toHaveLength(1);
      expect(oc[0]).toMatchObject({ usuario_id: 2, boleto_existente_id: existente.body.id, linha_digitavel: L3 });
    });

    it('virar "Sem Boleto" limpa a linha e o vencimento, e libera a linha para outros', async () => {
      const c = await post(U.gerenteA, boletoValido({ linha_digitavel: L1 })).expect(201);
      const res = await put(U.gerenteA, c.body.id, { tipo: 'Sem Boleto' }).expect(200);
      expect(res.body.tipo).toBe('Sem Boleto');
      expect(res.body.linha_digitavel).toBeNull();
      const row = await env.um('SELECT linha_digitavel, dt_vencimento FROM boletos_notas WHERE id = $1', [c.body.id]);
      expect(row).toEqual({ linha_digitavel: null, dt_vencimento: null });
      await post(U.gerenteB, boletoValido({ restaurante_id: 2, linha_digitavel: L1 })).expect(201);
    });

    it('linha vazia no PUT remove a linha', async () => {
      const c = await post(U.gerenteA, boletoValido({ linha_digitavel: L1 })).expect(201);
      await put(U.gerenteA, c.body.id, { linha_digitavel: '' }).expect(200);
      expect((await env.um('SELECT linha_digitavel FROM boletos_notas WHERE id = $1', [c.body.id])).linha_digitavel).toBeNull();
    });

    it('PUT sem o campo mantém a linha e o fornecedor', async () => {
      const c = await post(U.gerenteA, boletoValido({ linha_digitavel: L1, fornecedor: 'Casa X' })).expect(201);
      await put(U.gerenteA, c.body.id, { valor: 5 }).expect(200);
      const row = await env.um('SELECT linha_digitavel, fornecedor, fornecedor_norm FROM boletos_notas WHERE id = $1', [c.body.id]);
      expect(row).toEqual({ linha_digitavel: L1, fornecedor: 'Casa X', fornecedor_norm: 'casa x' });
    });

    it('PUT atualiza o fornecedor normalizado', async () => {
      await put(U.gerenteA, 10, { fornecedor: 'Padaria São José' }).expect(200);
      expect((await env.um('SELECT fornecedor_norm FROM boletos_notas WHERE id = 10')).fornecedor_norm).toBe('padaria sao jose');
    });
  });

  describe('similaridade (mesmo fornecedor + mesmo recebimento OU mesmo vencimento)', () => {
    beforeEach(async () => {
      await post(U.gerenteA, boletoValido({ fornecedor: 'Hortifruti São João', dt_recebimento: '2026-10-20', dt_vencimento: '2026-11-05' })).expect(201);
    });

    it('mesmo fornecedor (normalizado) e mesmo recebimento => 409 BOLETO_SIMILAR com os parecidos do próprio restaurante', async () => {
      const antes = await contarBoletos();
      const res = await post(
        U.gerenteA,
        boletoValido({ fornecedor: 'HORTIFRUTI sao joao', dt_recebimento: '2026-10-20', dt_vencimento: '2026-12-01' })
      ).expect(409);
      expect(res.body).toMatchObject({ codigo: 'BOLETO_SIMILAR', similar: true });
      expect(res.body.boletos).toHaveLength(1);
      expect(res.body.boletos[0]).toMatchObject({ restaurante_id: 1, fornecedor: 'Hortifruti São João' });
      expect(await contarBoletos()).toBe(antes);
      expect(await ocorrencias()).toHaveLength(0);
    });

    it('mesmo fornecedor e mesmo vencimento (recebimento diferente) => 409', async () => {
      const res = await post(
        U.gerenteA,
        boletoValido({ fornecedor: 'Hortifruti São João', dt_recebimento: '2026-10-25', dt_vencimento: '2026-11-05' })
      ).expect(409);
      expect(res.body.codigo).toBe('BOLETO_SIMILAR');
    });

    it('confirmar_similar === true cadastra mesmo assim', async () => {
      const antes = await contarBoletos();
      await post(U.gerenteA, boletoValido({ fornecedor: 'Hortifruti São João', confirmar_similar: true })).expect(201);
      expect(await contarBoletos()).toBe(antes + 1);
    });

    it.each(['true', 1, 'sim'])('confirmar_similar não-booleano (%p) NÃO confirma', async (confirmar_similar) => {
      await post(U.gerenteA, boletoValido({ fornecedor: 'Hortifruti São João', confirmar_similar })).expect(409);
    });

    it('fornecedor diferente com as mesmas datas => 201', async () => {
      await post(U.gerenteA, boletoValido({ fornecedor: 'Outro Fornecedor' })).expect(201);
    });

    it('mesmo fornecedor mas recebimento E vencimento diferentes => 201', async () => {
      await post(
        U.gerenteA,
        boletoValido({ fornecedor: 'Hortifruti São João', dt_recebimento: '2026-10-27', dt_vencimento: '2026-11-12' })
      ).expect(201);
    });

    it('sem fornecedor não há checagem de similaridade', async () => {
      await post(U.gerenteA, boletoValido()).expect(201);
    });

    it('similar em OUTRO restaurante não conta (e não vaza)', async () => {
      const res = await post(
        U.gerenteB,
        boletoValido({ restaurante_id: 2, fornecedor: 'Hortifruti São João' })
      ).expect(201);
      expect(res.body.restaurante_id).toBe(2);
    });

    it('similar já excluído não conta', async () => {
      await env.rows("UPDATE boletos_notas SET deleted_at = now() WHERE fornecedor = 'Hortifruti São João'");
      await post(U.gerenteA, boletoValido({ fornecedor: 'Hortifruti São João' })).expect(201);
    });

    it('"Sem Boleto" (vencimento nulo) não casa por vencimento nulo', async () => {
      await post(U.gerenteA, { restaurante_id: 1, descricao: 'N1', valor: 1, tipo: 'Sem Boleto', fornecedor: 'Mercado Z', dt_recebimento: '2026-10-01' }).expect(201);
      await post(U.gerenteA, { restaurante_id: 1, descricao: 'N2', valor: 1, tipo: 'Sem Boleto', fornecedor: 'Mercado Z', dt_recebimento: '2026-10-02' }).expect(201);
      await post(U.gerenteA, { restaurante_id: 1, descricao: 'N3', valor: 1, tipo: 'Sem Boleto', fornecedor: 'Mercado Z', dt_recebimento: '2026-10-02' }).expect(409);
    });
  });

  describe('anexo_id (ignorado: a imagem só entra por POST /boletos/:id/anexo)', () => {
    it('POST ignora anexo_id: cria o boleto, NÃO vincula o anexo livre e a resposta fica sem imagem', async () => {
      const anexo = await criarAnexo({ usuario_id: 2 });
      const res = await post(U.gerenteA, boletoValido({ anexo_id: anexo })).expect(201);
      expect(res.body.anexo_id).toBeNull();
      expect(res.body.tem_anexo).toBe(false);
      expect((await env.um('SELECT boleto_id FROM boletos_anexos WHERE id = $1', [anexo])).boleto_id).toBeNull();
    });

    it.each(['abc', -1, 0, 1.5, 99999, { x: 1 }])('POST com anexo_id %p é ignorado (201, sem erro de validação)', async (anexo_id) => {
      const res = await post(U.gerenteA, boletoValido({ anexo_id })).expect(201);
      expect(res.body.anexo_id).toBeNull();
    });

    it('POST não rouba anexo já vinculado a outro boleto (o vínculo original permanece)', async () => {
      const anexo = await criarAnexo({ usuario_id: 2, boleto_id: 10 });
      await post(U.gerenteA, boletoValido({ anexo_id: anexo })).expect(201);
      expect((await env.um('SELECT boleto_id FROM boletos_anexos WHERE id = $1', [anexo])).boleto_id).toBe(10);
    });

    it('PUT ignora anexo_id: atualiza os demais campos e não mexe em anexos', async () => {
      const livre = await criarAnexo({ usuario_id: 2 });
      const vinculado = await criarAnexo({ usuario_id: 2, boleto_id: 20, restaurante_id: 2 });
      const res = await put(U.gerenteA, 10, { anexo_id: livre, descricao: 'Novo nome' }).expect(200);
      expect(res.body.anexo_id).toBeNull();
      expect((await env.um('SELECT descricao FROM boletos_notas WHERE id = 10')).descricao).toBe('Novo nome');
      await put(U.gerenteA, 10, { anexo_id: vinculado, descricao: 'Outro' }).expect(200);
      expect((await env.um('SELECT boleto_id FROM boletos_anexos WHERE id = $1', [livre])).boleto_id).toBeNull();
      expect((await env.um('SELECT boleto_id FROM boletos_anexos WHERE id = $1', [vinculado])).boleto_id).toBe(20);
    });

    it('PUT não troca nem remove a imagem de um boleto que já tem anexo', async () => {
      const atual = await criarAnexo({ usuario_id: 2, boleto_id: 10 });
      const outro = await criarAnexo({ usuario_id: 2 });
      const res = await put(U.gerenteA, 10, { anexo_id: outro, descricao: 'Mantém' }).expect(200);
      expect(res.body.anexo_id).toBe(atual);
      expect((await env.um('SELECT boleto_id FROM boletos_anexos WHERE id = $1', [atual])).boleto_id).toBe(10);
      expect((await env.um('SELECT boleto_id FROM boletos_anexos WHERE id = $1', [outro])).boleto_id).toBeNull();
    });
  });

  describe('soft delete: todas as consultas respeitam deleted_at IS NULL', () => {
    async function criarEExcluir(extra = {}) {
      const c = await post(U.gerenteA, boletoValido({ dt_vencimento: '2026-10-21', valor: 77.7, ...extra })).expect(201);
      await request(env.app).delete(`/api/boletos/${c.body.id}`).set(auth(U.gerenteA)).expect(200);
      return c.body.id;
    }

    it('some da lista e do resumo/totais', async () => {
      const antes = await request(env.app).get('/api/boletos/resumo?restaurante_id=1').set(auth(U.gerenteA)).expect(200);
      const id = await criarEExcluir();
      const lista = await request(env.app).get('/api/boletos?restaurante_id=1').set(auth(U.gerenteA)).expect(200);
      expect(lista.body.map((b) => b.id)).not.toContain(id);
      const depois = await request(env.app).get('/api/boletos/resumo?restaurante_id=1').set(auth(U.gerenteA)).expect(200);
      expect(depois.body.total_geral).toBe(antes.body.total_geral);
      expect(depois.body.semanas).toEqual(antes.body.semanas);
    });

    it('antes de excluir o resumo conta o valor (o teste de cima não é vacuo)', async () => {
      const antes = await request(env.app).get('/api/boletos/resumo?restaurante_id=1').set(auth(U.gerenteA)).expect(200);
      await post(U.gerenteA, boletoValido({ dt_vencimento: '2026-10-21', valor: 77.7 })).expect(201);
      const depois = await request(env.app).get('/api/boletos/resumo?restaurante_id=1').set(auth(U.gerenteA)).expect(200);
      expect(depois.body.total_geral).toBe(Math.round((antes.body.total_geral + 77.7) * 100) / 100);
    });

    it('a meta continua existindo e o saldo ignora o excluído', async () => {
      await env.rows("UPDATE boletos_notas SET dt_vencimento = '2026-10-21' WHERE id = 10");
      await criarEExcluir();
      const res = await request(env.app).get('/api/boletos/resumo?restaurante_id=1').set(auth(U.gerenteA)).expect(200);
      const semana = res.body.semanas.find((s) => s.maximo === 1000);
      expect(semana.total).toBe(100.5);
      expect(semana.saldo).toBe(899.5);
    });

    it('PUT em excluído => 404 e nada muda', async () => {
      const id = await criarEExcluir({ descricao: 'Original' });
      await put(U.gerenteA, id, { descricao: 'Mudou' }).expect(404);
      expect((await env.um('SELECT descricao FROM boletos_notas WHERE id = $1', [id])).descricao).toBe('Original');
    });

    it('DELETE em excluído => 404 e não regrava deleted_at', async () => {
      const id = await criarEExcluir();
      const antes = await env.um('SELECT deleted_at, deleted_by_usuario_id FROM boletos_notas WHERE id = $1', [id]);
      await request(env.app).delete(`/api/boletos/${id}`).set(auth(U.admin)).expect(404);
      const depois = await env.um('SELECT deleted_at, deleted_by_usuario_id FROM boletos_notas WHERE id = $1', [id]);
      expect(depois).toEqual(antes);
    });

    it('pagar, desfazer e baixar imagem de excluído => 404', async () => {
      const id = await criarEExcluir();
      await request(env.app).post(`/api/boletos/${id}/pago`).set(auth(U.admin)).expect(404);
      await request(env.app).delete(`/api/boletos/${id}/pago`).set(auth(U.admin)).send({ motivo: 'motivo válido' }).expect(404);
      await request(env.app).get(`/api/boletos/${id}/anexo`).set(auth(U.admin)).expect(404);
    });

    it('excluir é feito pelo dono do restaurante; outro restaurante não exclui (403) e o registro segue ativo', async () => {
      await request(env.app).delete('/api/boletos/10').set(auth(U.gerenteB)).expect(403);
      expect((await env.um('SELECT deleted_at FROM boletos_notas WHERE id = 10')).deleted_at).toBeNull();
    });
  });
});
