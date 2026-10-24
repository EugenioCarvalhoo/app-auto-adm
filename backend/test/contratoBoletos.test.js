/**
 * Contrato de /api/boletos*: corpos exatos de sucesso e de erro, mensagens, ordem das validações,
 * efeitos no banco e isolamento por restaurante em boletos e metas.
 */
const request = require('supertest');
const { usarBancoReal, auth, U } = require('./helpers/setup');

const env = usarBancoReal();

const CHAVES_BOLETO = [
  'created_at', 'descricao', 'dt_recebimento', 'dt_vencimento', 'dt_vencimento_efetivo', 'id',
  'restaurante_id', 'semana_chave', 'semana_fim', 'semana_inicio', 'tipo', 'updated_at', 'usuario_id', 'valor'
];
const CHAVES_META = ['created_at', 'data_referencia', 'id', 'maximo_gasto', 'restaurante_id', 'semana_chave', 'semana_fim', 'semana_inicio', 'updated_at'];

const ROTA = '/api/boletos';
const boleto = (extra = {}) => ({
  restaurante_id: 1,
  descricao: 'Hortifruti',
  valor: '150,75',
  tipo: 'Boleto',
  dt_recebimento: '2026-10-20',
  dt_vencimento: '2026-11-05',
  ...extra
});
const nBoletos = async () => Number((await env.um('SELECT count(*) AS n FROM boletos_notas')).n);
const nMetas = async () => Number((await env.um('SELECT count(*) AS n FROM boletos_metas_gasto')).n);

describe('contrato de boletos', () => {
  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  describe('GET /api/boletos', () => {
    it('200: array com os campos exatos e valores tipados (valor number, datas YYYY-MM-DD)', async () => {
      const res = await request(env.app).get(`${ROTA}?restaurante_id=1`).set(auth(U.gerenteA)).expect(200);
      expect(res.headers['content-type']).toMatch(/application\/json/);
      expect(res.body).toHaveLength(1);
      const b = res.body[0];
      expect(Object.keys(b).sort()).toEqual(CHAVES_BOLETO);
      expect(b).toMatchObject({
        id: 10,
        restaurante_id: 1,
        usuario_id: 2,
        dt_recebimento: '2026-10-19',
        dt_vencimento: '2026-10-30',
        descricao: 'Fornecedor A',
        valor: 100.5,
        tipo: 'Boleto',
        dt_vencimento_efetivo: '2026-10-30',
        semana_chave: '20261024.20261030',
        semana_inicio: '2026-10-24',
        semana_fim: '2026-10-30'
      });
      expect(new Date(b.created_at).toString()).not.toBe('Invalid Date');
      expect(new Date(b.updated_at).toString()).not.toBe('Invalid Date');
    });

    it('ordena por recebimento desc e, no empate, por id desc', async () => {
      await env.rows(
        `INSERT INTO boletos_notas (id, restaurante_id, usuario_id, dt_recebimento, dt_vencimento, descricao, valor, tipo) VALUES
          (11, 1, 2, '2026-10-19', '2026-10-30', 'mesmo dia', 1, 'Boleto'),
          (12, 1, 2, '2026-10-25', '2026-10-30', 'mais novo', 1, 'Boleto'),
          (13, 1, 2, '2026-10-01', '2026-10-30', 'mais antigo', 1, 'Boleto')`
      );
      const res = await request(env.app).get(`${ROTA}?restaurante_id=1`).set(auth(U.admin)).expect(200);
      expect(res.body.map((b) => b.id)).toEqual([12, 11, 10, 13]);
    });

    it('"Sem Boleto": vencimento efetivo = recebimento + 7 dias e semana calculada sobre ele', async () => {
      await env.rows("UPDATE boletos_notas SET tipo = 'Sem Boleto', dt_vencimento = NULL, dt_recebimento = '2026-10-20' WHERE id = 10");
      const res = await request(env.app).get(`${ROTA}?restaurante_id=1`).set(auth(U.admin)).expect(200);
      expect(res.body[0]).toMatchObject({
        tipo: 'Sem Boleto',
        dt_vencimento: null,
        dt_vencimento_efetivo: '2026-10-27',
        semana_chave: '20261024.20261030'
      });
    });

    it('restaurante sem boletos: 200 com array vazio', async () => {
      await env.rows('DELETE FROM boletos_notas WHERE restaurante_id = 1');
      const res = await request(env.app).get(`${ROTA}?restaurante_id=1`).set(auth(U.gerenteA)).expect(200);
      expect(res.body).toEqual([]);
    });

    it('400 "restaurante_id é obrigatório" sem o parâmetro ou não numérico (também em /resumo e /metas)', async () => {
      for (const caminho of [ROTA, `${ROTA}/resumo`, `${ROTA}/metas`]) {
        const a = await request(env.app).get(caminho).set(auth(U.admin)).expect(400);
        expect(a.body).toEqual({ error: 'restaurante_id é obrigatório' });
        await request(env.app).get(`${caminho}?restaurante_id=abc`).set(auth(U.admin)).expect(400);
      }
    });

    it('a checagem de módulo vem antes da validação do parâmetro (403, não 400)', async () => {
      await request(env.app).get(ROTA).set(auth(U.semModulo)).expect(403);
    });

    it('admin lendo restaurante inexistente: 200 com lista vazia (não 404)', async () => {
      const res = await request(env.app).get(`${ROTA}?restaurante_id=999`).set(auth(U.admin)).expect(200);
      expect(res.body).toEqual([]);
    });

    it('usuário comum lendo restaurante inexistente: 403', async () => {
      await request(env.app).get(`${ROTA}?restaurante_id=999`).set(auth(U.gerenteA)).expect(403);
    });
  });

  describe('GET /api/boletos/resumo', () => {
    it('200: { semanas, total_geral } com semana da meta sem lançamentos (saldo = máximo) e semana sem meta (maximo/saldo null)', async () => {
      const res = await request(env.app).get(`${ROTA}/resumo?restaurante_id=1`).set(auth(U.gerenteA)).expect(200);
      expect(Object.keys(res.body).sort()).toEqual(['semanas', 'total_geral']);
      expect(res.body.semanas).toEqual([
        { chave: '20261017.20261023', inicio: '2026-10-17', fim: '2026-10-23', total: 0, quantidade: 0, maximo: 1000, saldo: 1000 },
        { chave: '20261024.20261030', inicio: '2026-10-24', fim: '2026-10-30', total: 100.5, quantidade: 1, maximo: null, saldo: null }
      ]);
      expect(res.body.total_geral).toBe(100.5);
    });

    it('restaurante sem dados: { semanas: [], total_geral: 0 }', async () => {
      await env.rows('DELETE FROM boletos_notas WHERE restaurante_id = 1');
      await env.rows('DELETE FROM boletos_metas_gasto WHERE restaurante_id = 1');
      const res = await request(env.app).get(`${ROTA}/resumo?restaurante_id=1`).set(auth(U.gerenteA)).expect(200);
      expect(res.body).toEqual({ semanas: [], total_geral: 0 });
    });

    it('saldo negativo quando o total passa da meta, sem erro de ponto flutuante', async () => {
      await env.rows(
        `INSERT INTO boletos_notas (restaurante_id, usuario_id, dt_recebimento, dt_vencimento, descricao, valor, tipo) VALUES
          (1, 2, '2026-10-19', '2026-10-21', 'a', 700.10, 'Boleto'),
          (1, 2, '2026-10-19', '2026-10-22', 'b', 400.20, 'Boleto')`
      );
      const res = await request(env.app).get(`${ROTA}/resumo?restaurante_id=1`).set(auth(U.admin)).expect(200);
      const semana = res.body.semanas.find((s) => s.chave === '20261017.20261023');
      expect(semana).toMatchObject({ total: 1100.3, quantidade: 2, maximo: 1000, saldo: -100.3 });
      expect(res.body.total_geral).toBe(1200.8);
    });

    it('403 em restaurante não vinculado, 401 sem token', async () => {
      await request(env.app).get(`${ROTA}/resumo?restaurante_id=2`).set(auth(U.gerenteA)).expect(403);
      await request(env.app).get(`${ROTA}/resumo?restaurante_id=1`).expect(401);
    });
  });

  describe('POST /api/boletos', () => {
    it('201: corpo igual ao GET (campos exatos), usuário vem do token e o valor é aceito em formato brasileiro', async () => {
      const res = await request(env.app).post(ROTA).set(auth(U.gerenteA)).send(boleto({ valor: 'R$ 1.234,56' })).expect(201);
      expect(Object.keys(res.body).sort()).toEqual(CHAVES_BOLETO);
      expect(res.body).toMatchObject({
        restaurante_id: 1,
        usuario_id: 2,
        descricao: 'Hortifruti',
        valor: 1234.56,
        tipo: 'Boleto',
        dt_recebimento: '2026-10-20',
        dt_vencimento: '2026-11-05',
        dt_vencimento_efetivo: '2026-11-05',
        semana_chave: '20261031.20261106'
      });
      const salvo = await env.um('SELECT * FROM boletos_notas WHERE id = $1', [res.body.id]);
      expect(salvo).toMatchObject({ restaurante_id: 1, usuario_id: 2, descricao: 'Hortifruti', tipo: 'Boleto' });
      expect(Number(salvo.valor)).toBe(1234.56);
      expect(await nBoletos()).toBe(3);
    });

    it('usuario_id enviado no corpo é ignorado (vem sempre do token)', async () => {
      const res = await request(env.app).post(ROTA).set(auth(U.gerenteA)).send(boleto({ usuario_id: 3 })).expect(201);
      expect(res.body.usuario_id).toBe(2);
    });

    it('descrição é aparada; restaurante_id aceita string numérica', async () => {
      const res = await request(env.app).post(ROTA).set(auth(U.gerenteA)).send(boleto({ descricao: '  Gelo  ', restaurante_id: '1' })).expect(201);
      expect(res.body.descricao).toBe('Gelo');
    });

    it('datas com horário (ISO completo) são cortadas nos 10 primeiros caracteres', async () => {
      const res = await request(env.app)
        .post(ROTA)
        .set(auth(U.gerenteA))
        .send(boleto({ dt_recebimento: '2026-10-20T23:30:00.000Z', dt_vencimento: '2026-11-05T01:00:00-03:00' }))
        .expect(201);
      expect(res.body).toMatchObject({ dt_recebimento: '2026-10-20', dt_vencimento: '2026-11-05' });
    });

    it.each([
      ['Sem Boleto', 'Sem Boleto'],
      ['sem boleto', 'Sem Boleto'],
      ['  SEM_BOLETO ', 'Sem Boleto'],
      ['Boleto', 'Boleto'],
      ['qualquer coisa', 'Boleto'],
      [undefined, 'Boleto']
    ])('tipo %p é normalizado para %p', async (tipo, esperado) => {
      const res = await request(env.app).post(ROTA).set(auth(U.gerenteA)).send(boleto({ tipo })).expect(201);
      expect(res.body.tipo).toBe(esperado);
      expect((await env.um('SELECT tipo FROM boletos_notas WHERE id = $1', [res.body.id])).tipo).toBe(esperado);
    });

    it('"Sem Boleto": vencimento do corpo é descartado, efetivo = recebimento + 7', async () => {
      const res = await request(env.app)
        .post(ROTA)
        .set(auth(U.gerenteA))
        .send(boleto({ tipo: 'Sem Boleto', dt_vencimento: '2026-12-31', dt_recebimento: '2026-10-20' }))
        .expect(201);
      expect(res.body).toMatchObject({ dt_vencimento: null, dt_vencimento_efetivo: '2026-10-27' });
    });

    it('400 com a mensagem exata de cada validação, sem gravar nada', async () => {
      const casos = [
        [boleto({ restaurante_id: undefined }), 'restaurante_id é obrigatório'],
        [boleto({ restaurante_id: 'abc' }), 'restaurante_id é obrigatório'],
        [boleto({ descricao: '   ' }), 'Descrição é obrigatória'],
        [boleto({ descricao: undefined }), 'Descrição é obrigatória'],
        [boleto({ valor: 'abc' }), 'Valor inválido'],
        [boleto({ valor: undefined }), 'Valor inválido'],
        [boleto({ valor: '-1' }), 'Valor inválido'],
        [boleto({ valor: '1000000000000' }), 'Valor inválido'],
        [boleto({ dt_recebimento: undefined }), 'Data de recebimento é obrigatória'],
        [boleto({ dt_recebimento: '2026-02-31' }), 'Data de recebimento é obrigatória'],
        [boleto({ dt_recebimento: '20/10/2026' }), 'Data de recebimento é obrigatória'],
        [boleto({ dt_vencimento: undefined }), 'Data de vencimento é obrigatória para boleto'],
        [boleto({ dt_vencimento: '2026-13-01' }), 'Data de vencimento é obrigatória para boleto']
      ];
      for (const [corpo, mensagem] of casos) {
        const res = await request(env.app).post(ROTA).set(auth(U.gerenteA)).send(corpo);
        expect({ corpo, status: res.status, body: res.body }).toEqual({ corpo, status: 400, body: { error: mensagem } });
      }
      expect(await nBoletos()).toBe(2);
    });

    it('ordem das validações: acesso ao restaurante (403) vem antes da validação do corpo (400)', async () => {
      const res = await request(env.app).post(ROTA).set(auth(U.gerenteA)).send(boleto({ restaurante_id: 2, descricao: '' })).expect(403);
      expect(res.body).toEqual({ error: 'Sem permissão para os boletos deste restaurante.' });
    });

    it('403 sem módulo e nada é gravado', async () => {
      const res = await request(env.app).post(ROTA).set(auth(U.semModulo)).send(boleto()).expect(403);
      expect(res.body).toEqual({ error: 'Sem permissão para o módulo de boletos e notas.' });
      expect(await nBoletos()).toBe(2);
    });

    it('admin cria em qualquer restaurante ativo', async () => {
      const res = await request(env.app).post(ROTA).set(auth(U.admin)).send(boleto({ restaurante_id: 2 })).expect(201);
      expect(res.body).toMatchObject({ restaurante_id: 2, usuario_id: 1 });
    });

    // BUG DE PRODUCAO (reportado): admin com restaurante_id inexistente viola a FK e a API responde 500.
    it.failing('BUG: admin criando boleto em restaurante inexistente deveria ser 4xx, não 500', async () => {
      const res = await request(env.app).post(ROTA).set(auth(U.admin)).send(boleto({ restaurante_id: 999 }));
      expect(res.status).toBeLessThan(500);
    });
  });

  describe('PUT /api/boletos/:id', () => {
    it('200: devolve o boleto atualizado (campos exatos); só os campos enviados mudam; updated_at avança', async () => {
      const antes = await env.um('SELECT updated_at FROM boletos_notas WHERE id = 10');
      const res = await request(env.app).put(`${ROTA}/10`).set(auth(U.gerenteA)).send({ descricao: '  Novo  ', valor: '10,5' }).expect(200);
      expect(Object.keys(res.body).sort()).toEqual(CHAVES_BOLETO);
      expect(res.body).toMatchObject({ id: 10, descricao: 'Novo', valor: 10.5, dt_recebimento: '2026-10-19', dt_vencimento: '2026-10-30', tipo: 'Boleto', usuario_id: 2 });
      const depois = await env.um('SELECT * FROM boletos_notas WHERE id = 10');
      expect(depois).toMatchObject({ descricao: 'Novo', restaurante_id: 1, usuario_id: 2 });
      expect(Number(depois.valor)).toBe(10.5);
      expect(depois.updated_at.getTime()).toBeGreaterThan(antes.updated_at.getTime());
    });

    it('o autor do lançamento não muda quando outro usuário edita (usuario_id preservado)', async () => {
      await request(env.app).put(`${ROTA}/10`).set(auth(U.admin)).send({ descricao: 'Admin editou' }).expect(200);
      expect((await env.um('SELECT usuario_id FROM boletos_notas WHERE id = 10')).usuario_id).toBe(2);
    });

    it('trocar para "Sem Boleto" zera o vencimento; voltar a "Boleto" sem informar vencimento é 400', async () => {
      const a = await request(env.app).put(`${ROTA}/10`).set(auth(U.gerenteA)).send({ tipo: 'Sem Boleto' }).expect(200);
      expect(a.body).toMatchObject({ tipo: 'Sem Boleto', dt_vencimento: null, dt_vencimento_efetivo: '2026-10-26' });
      expect((await env.um('SELECT dt_vencimento FROM boletos_notas WHERE id = 10')).dt_vencimento).toBeNull();

      const b = await request(env.app).put(`${ROTA}/10`).set(auth(U.gerenteA)).send({ tipo: 'Boleto' }).expect(400);
      expect(b.body).toEqual({ error: 'Data de vencimento é obrigatória para boleto' });
      expect((await env.um('SELECT tipo FROM boletos_notas WHERE id = 10')).tipo).toBe('Sem Boleto');

      await request(env.app).put(`${ROTA}/10`).set(auth(U.gerenteA)).send({ tipo: 'Boleto', dt_vencimento: '2026-11-10' }).expect(200);
    });

    it('400 com mensagens exatas e nada muda no banco', async () => {
      const casos = [
        [{ descricao: '  ' }, 'Descrição é obrigatória'],
        [{ valor: 'abc' }, 'Valor inválido'],
        [{ valor: null }, 'Valor inválido'],
        [{ valor: -3 }, 'Valor inválido'],
        [{ dt_recebimento: '' }, 'Data de recebimento é obrigatória'],
        [{ dt_recebimento: '2026-02-30' }, 'Data de recebimento é obrigatória'],
        [{ dt_vencimento: null }, 'Data de vencimento é obrigatória para boleto'],
        [{ dt_vencimento: '2026-02-30' }, 'Data de vencimento é obrigatória para boleto']
      ];
      for (const [corpo, mensagem] of casos) {
        const res = await request(env.app).put(`${ROTA}/10`).set(auth(U.gerenteA)).send(corpo);
        expect({ corpo, status: res.status, body: res.body }).toEqual({ corpo, status: 400, body: { error: mensagem } });
      }
      const linha = await env.um('SELECT descricao, valor, dt_recebimento, dt_vencimento FROM boletos_notas WHERE id = 10');
      expect(linha.descricao).toBe('Fornecedor A');
      expect(Number(linha.valor)).toBe(100.5);
    });

    it('400 "id inválido" para id não numérico; 404 "Lançamento não encontrado" para inexistente', async () => {
      const a = await request(env.app).put(`${ROTA}/abc`).set(auth(U.admin)).send({}).expect(400);
      expect(a.body).toEqual({ error: 'id inválido' });
      const b = await request(env.app).put(`${ROTA}/999`).set(auth(U.admin)).send({}).expect(404);
      expect(b.body).toEqual({ error: 'Lançamento não encontrado' });
    });

    it('403 em boleto de outro restaurante; para usuário sem módulo também (mensagens exatas)', async () => {
      const a = await request(env.app).put(`${ROTA}/20`).set(auth(U.gerenteA)).send({ descricao: 'Hack' }).expect(403);
      expect(a.body).toEqual({ error: 'Sem permissão para os boletos deste restaurante.' });
      const b = await request(env.app).put(`${ROTA}/10`).set(auth(U.semModulo)).send({ descricao: 'Hack' }).expect(403);
      expect(b.body).toEqual({ error: 'Sem permissão para o módulo de boletos e notas.' });
      expect((await env.um('SELECT descricao FROM boletos_notas WHERE id IN (10, 20) ORDER BY id')).descricao).toBe('Fornecedor A');
    });

    it('usuário sem vínculo recebe 403 mesmo conhecendo o id', async () => {
      await request(env.app).put(`${ROTA}/10`).set(auth(U.semVinculo)).send({ descricao: 'x' }).expect(403);
    });

    // BUG DE PRODUCAO (reportado): id fora do intervalo de INTEGER estoura no Postgres e vira 500.
    it.failing('BUG: id gigante (fora de int4) deveria ser 4xx, não 500', async () => {
      const res = await request(env.app).put(`${ROTA}/99999999999`).set(auth(U.admin)).send({});
      expect(res.status).toBeLessThan(500);
    });
  });

  describe('DELETE /api/boletos/:id', () => {
    it('200 { message, id }: remove só aquele registro', async () => {
      const res = await request(env.app).delete(`${ROTA}/10`).set(auth(U.gerenteA)).expect(200);
      expect(res.body).toEqual({ message: 'Lançamento removido', id: 10 });
      expect(await env.um('SELECT 1 FROM boletos_notas WHERE id = 10')).toBeUndefined();
      expect(await env.um('SELECT 1 FROM boletos_notas WHERE id = 20')).toBeDefined();
    });

    it('403 com mensagem exata para usuário comum em lançamento com mais de 1 dia; admin remove', async () => {
      await env.rows("UPDATE boletos_notas SET created_at = now() - interval '2 days' WHERE id = 10");
      const res = await request(env.app).delete(`${ROTA}/10`).set(auth(U.gerenteA)).expect(403);
      expect(res.body).toEqual({ error: 'Só o administrador pode excluir um lançamento com mais de 1 dia.' });
      expect(await env.um('SELECT 1 FROM boletos_notas WHERE id = 10')).toBeDefined();
      const ok = await request(env.app).delete(`${ROTA}/10`).set(auth(U.admin)).expect(200);
      expect(ok.body).toEqual({ message: 'Lançamento removido', id: 10 });
    });

    it('lançamento com 12h ainda pode ser removido pelo usuário comum', async () => {
      await env.rows("UPDATE boletos_notas SET created_at = now() - interval '12 hours' WHERE id = 10");
      await request(env.app).delete(`${ROTA}/10`).set(auth(U.gerenteA)).expect(200);
    });

    it('um colega do mesmo restaurante também pode remover um lançamento recente (a regra é por restaurante, não por autor)', async () => {
      await env.rows('INSERT INTO usuario_restaurantes (usuario_id, restaurante_id) VALUES (6, 1) ON CONFLICT DO NOTHING');
      await request(env.app).delete(`${ROTA}/10`).set(auth(U.financeiroLegado)).expect(200);
    });

    it('400 "id inválido", 404 "Lançamento não encontrado", 403 em outro restaurante (nada removido)', async () => {
      expect((await request(env.app).delete(`${ROTA}/abc`).set(auth(U.admin)).expect(400)).body).toEqual({ error: 'id inválido' });
      expect((await request(env.app).delete(`${ROTA}/999`).set(auth(U.admin)).expect(404)).body).toEqual({ error: 'Lançamento não encontrado' });
      expect((await request(env.app).delete(`${ROTA}/20`).set(auth(U.gerenteA)).expect(403)).body).toEqual({
        error: 'Sem permissão para os boletos deste restaurante.'
      });
      expect(await nBoletos()).toBe(2);
    });

    it('403 sem módulo', async () => {
      await request(env.app).delete(`${ROTA}/10`).set(auth(U.semModulo)).expect(403);
      expect(await nBoletos()).toBe(2);
    });
  });

  describe('metas: GET /api/boletos/metas', () => {
    it('200: array com campos exatos, datas YYYY-MM-DD e maximo_gasto number', async () => {
      const res = await request(env.app).get(`${ROTA}/metas?restaurante_id=1`).set(auth(U.gerenteA)).expect(200);
      expect(res.body).toHaveLength(1);
      expect(Object.keys(res.body[0]).sort()).toEqual(CHAVES_META);
      expect(res.body[0]).toMatchObject({
        id: 1,
        restaurante_id: 1,
        data_referencia: '2026-10-19',
        semana_chave: '20261017.20261023',
        semana_inicio: '2026-10-17',
        semana_fim: '2026-10-23',
        maximo_gasto: 1000
      });
    });

    it('ordenado da semana mais recente para a mais antiga', async () => {
      await request(env.app).post(`${ROTA}/metas`).set(auth(U.gerenteA)).send({ restaurante_id: 1, data_referencia: '2026-11-04', maximo_gasto: 5 }).expect(201);
      await request(env.app).post(`${ROTA}/metas`).set(auth(U.gerenteA)).send({ restaurante_id: 1, data_referencia: '2026-09-01', maximo_gasto: 5 }).expect(201);
      const res = await request(env.app).get(`${ROTA}/metas?restaurante_id=1`).set(auth(U.gerenteA)).expect(200);
      expect(res.body.map((m) => m.semana_inicio)).toEqual(['2026-10-31', '2026-10-17', '2026-08-29']);
    });

    it('403 em outro restaurante; 401 sem token', async () => {
      await request(env.app).get(`${ROTA}/metas?restaurante_id=2`).set(auth(U.gerenteA)).expect(403);
      await request(env.app).get(`${ROTA}/metas?restaurante_id=1`).expect(401);
    });
  });

  describe('metas: POST /api/boletos/metas', () => {
    it('201: calcula a semana sábado–sexta a partir da data de referência e grava', async () => {
      // 2026-11-04 é quarta: semana de 31/10 (sáb) a 06/11 (sex)
      const res = await request(env.app)
        .post(`${ROTA}/metas`)
        .set(auth(U.gerenteA))
        .send({ restaurante_id: 1, data_referencia: '2026-11-04', maximo_gasto: '1.500,50' })
        .expect(201);
      expect(Object.keys(res.body).sort()).toEqual(CHAVES_META);
      expect(res.body).toMatchObject({
        restaurante_id: 1,
        data_referencia: '2026-11-04',
        semana_chave: '20261031.20261106',
        semana_inicio: '2026-10-31',
        semana_fim: '2026-11-06',
        maximo_gasto: 1500.5
      });
      const salvo = await env.um('SELECT * FROM boletos_metas_gasto WHERE id = $1', [res.body.id]);
      expect(salvo).toMatchObject({ restaurante_id: 1, semana_chave: '20261031.20261106' });
      expect(Number(salvo.maximo_gasto)).toBe(1500.5);
    });

    it('sábado e sexta caem na mesma semana; o dia seguinte à sexta abre outra', async () => {
      const post = (d) => request(env.app).post(`${ROTA}/metas`).set(auth(U.admin)).send({ restaurante_id: 1, data_referencia: d, maximo_gasto: 1 }).expect(201);
      expect((await post('2026-10-17')).body.semana_chave).toBe('20261017.20261023');
      expect((await post('2026-10-23')).body.semana_chave).toBe('20261017.20261023');
      expect((await post('2026-10-24')).body.semana_chave).toBe('20261024.20261030');
    });

    it('upsert na mesma semana: devolve 201 com o MESMO id, atualiza data_referencia e máximo, e não duplica', async () => {
      const res = await request(env.app)
        .post(`${ROTA}/metas`)
        .set(auth(U.gerenteA))
        .send({ restaurante_id: 1, data_referencia: '2026-10-22', maximo_gasto: 77 })
        .expect(201);
      expect(res.body).toMatchObject({ id: 1, data_referencia: '2026-10-22', maximo_gasto: 77 });
      expect(await nMetas()).toBe(2);
      expect(await env.um('SELECT data_referencia::text AS d FROM boletos_metas_gasto WHERE id = 1')).toEqual({ d: '2026-10-22' });
    });

    it('a mesma semana em outro restaurante é uma meta independente (não sobrescreve a do vizinho)', async () => {
      await request(env.app).post(`${ROTA}/metas`).set(auth(U.admin)).send({ restaurante_id: 2, data_referencia: '2026-10-20', maximo_gasto: 5 }).expect(201);
      expect(Number((await env.um('SELECT maximo_gasto FROM boletos_metas_gasto WHERE id = 1')).maximo_gasto)).toBe(1000);
      expect(Number((await env.um('SELECT maximo_gasto FROM boletos_metas_gasto WHERE id = 2')).maximo_gasto)).toBe(5);
    });

    it('aceita máximo 0', async () => {
      const res = await request(env.app).post(`${ROTA}/metas`).set(auth(U.gerenteA)).send({ restaurante_id: 1, data_referencia: '2026-12-01', maximo_gasto: 0 }).expect(201);
      expect(res.body.maximo_gasto).toBe(0);
    });

    it('400 com mensagens exatas, sem gravar', async () => {
      const casos = [
        [{ data_referencia: '2026-10-20', maximo_gasto: 1 }, 'restaurante_id é obrigatório', { restaurante_id: undefined }],
        [{ maximo_gasto: 1 }, 'Informe uma data dentro da semana da meta'],
        [{ data_referencia: '2026-02-31', maximo_gasto: 1 }, 'Informe uma data dentro da semana da meta'],
        [{ data_referencia: '2026-10-20' }, 'Máximo de gasto inválido'],
        [{ data_referencia: '2026-10-20', maximo_gasto: 'abc' }, 'Máximo de gasto inválido'],
        [{ data_referencia: '2026-10-20', maximo_gasto: -1 }, 'Máximo de gasto inválido'],
        [{ data_referencia: '2026-10-20', maximo_gasto: '1000000000000' }, 'Máximo de gasto inválido']
      ];
      for (const [corpo, mensagem, extra] of casos) {
        const enviado = { restaurante_id: 1, ...corpo, ...(extra || {}) };
        const res = await request(env.app).post(`${ROTA}/metas`).set(auth(U.gerenteA)).send(enviado);
        expect({ enviado, status: res.status, body: res.body }).toEqual({ enviado, status: 400, body: { error: mensagem } });
      }
      expect(await nMetas()).toBe(2);
    });

    it('403 em restaurante não vinculado e sem módulo; nada é gravado', async () => {
      const corpo = { restaurante_id: 2, data_referencia: '2026-11-04', maximo_gasto: 1 };
      expect((await request(env.app).post(`${ROTA}/metas`).set(auth(U.gerenteA)).send(corpo).expect(403)).body).toEqual({
        error: 'Sem permissão para os boletos deste restaurante.'
      });
      await request(env.app).post(`${ROTA}/metas`).set(auth(U.semModulo)).send({ ...corpo, restaurante_id: 1 }).expect(403);
      expect(await nMetas()).toBe(2);
    });
  });

  describe('metas: PUT /api/boletos/metas/:id', () => {
    it('200: só o máximo muda quando só ele é enviado (data e semana preservadas); updated_at avança', async () => {
      const antes = await env.um('SELECT updated_at FROM boletos_metas_gasto WHERE id = 1');
      const res = await request(env.app).put(`${ROTA}/metas/1`).set(auth(U.gerenteA)).send({ maximo_gasto: '250,25' }).expect(200);
      expect(Object.keys(res.body).sort()).toEqual(CHAVES_META);
      expect(res.body).toMatchObject({ id: 1, maximo_gasto: 250.25, data_referencia: '2026-10-19', semana_chave: '20261017.20261023' });
      const depois = await env.um('SELECT * FROM boletos_metas_gasto WHERE id = 1');
      expect(Number(depois.maximo_gasto)).toBe(250.25);
      expect(depois.updated_at.getTime()).toBeGreaterThan(antes.updated_at.getTime());
    });

    it('mudar a data para outra semana recalcula chave/início/fim', async () => {
      const res = await request(env.app).put(`${ROTA}/metas/1`).set(auth(U.gerenteA)).send({ data_referencia: '2026-11-04' }).expect(200);
      expect(res.body).toMatchObject({ semana_chave: '20261031.20261106', semana_inicio: '2026-10-31', semana_fim: '2026-11-06', maximo_gasto: 1000 });
      expect((await env.um('SELECT semana_chave FROM boletos_metas_gasto WHERE id = 1')).semana_chave).toBe('20261031.20261106');
    });

    it('409 "Já existe meta para esta semana." ao mover para semana já ocupada; a meta fica como estava', async () => {
      await request(env.app).post(`${ROTA}/metas`).set(auth(U.gerenteA)).send({ restaurante_id: 1, data_referencia: '2026-11-04', maximo_gasto: 5 }).expect(201);
      const res = await request(env.app).put(`${ROTA}/metas/1`).set(auth(U.gerenteA)).send({ data_referencia: '2026-11-05' }).expect(409);
      expect(res.body).toEqual({ error: 'Já existe meta para esta semana.' });
      expect((await env.um('SELECT semana_chave FROM boletos_metas_gasto WHERE id = 1')).semana_chave).toBe('20261017.20261023');
    });

    it('400 com mensagens exatas; nada muda', async () => {
      const casos = [
        [{ data_referencia: '' }, 'Informe uma data dentro da semana da meta'],
        [{ data_referencia: '2026-02-30' }, 'Informe uma data dentro da semana da meta'],
        [{ maximo_gasto: 'abc' }, 'Máximo de gasto inválido'],
        [{ maximo_gasto: null }, 'Máximo de gasto inválido'],
        [{ maximo_gasto: '1000000000000' }, 'Máximo de gasto inválido']
      ];
      for (const [corpo, mensagem] of casos) {
        const res = await request(env.app).put(`${ROTA}/metas/1`).set(auth(U.gerenteA)).send(corpo);
        expect({ corpo, status: res.status, body: res.body }).toEqual({ corpo, status: 400, body: { error: mensagem } });
      }
      expect(Number((await env.um('SELECT maximo_gasto FROM boletos_metas_gasto WHERE id = 1')).maximo_gasto)).toBe(1000);
    });

    it('400 "id inválido"; 404 "Meta não encontrada"; 403 em meta de outro restaurante', async () => {
      expect((await request(env.app).put(`${ROTA}/metas/abc`).set(auth(U.admin)).send({}).expect(400)).body).toEqual({ error: 'id inválido' });
      expect((await request(env.app).put(`${ROTA}/metas/999`).set(auth(U.admin)).send({}).expect(404)).body).toEqual({ error: 'Meta não encontrada' });
      expect((await request(env.app).put(`${ROTA}/metas/2`).set(auth(U.gerenteA)).send({ maximo_gasto: 1 }).expect(403)).body).toEqual({
        error: 'Sem permissão para os boletos deste restaurante.'
      });
      expect(Number((await env.um('SELECT maximo_gasto FROM boletos_metas_gasto WHERE id = 2')).maximo_gasto)).toBe(2000);
    });

    it('restaurante_id no corpo do PUT é ignorado (não move a meta para outro restaurante)', async () => {
      await request(env.app).put(`${ROTA}/metas/1`).set(auth(U.gerenteA)).send({ restaurante_id: 2, maximo_gasto: 9 }).expect(200);
      expect((await env.um('SELECT restaurante_id FROM boletos_metas_gasto WHERE id = 1')).restaurante_id).toBe(1);
    });
  });

  describe('metas: DELETE /api/boletos/metas/:id', () => {
    it('200 { message, id }: remove só aquela meta', async () => {
      const res = await request(env.app).delete(`${ROTA}/metas/1`).set(auth(U.gerenteA)).expect(200);
      expect(res.body).toEqual({ message: 'Meta removida', id: 1 });
      expect(await env.um('SELECT 1 FROM boletos_metas_gasto WHERE id = 1')).toBeUndefined();
      expect(await env.um('SELECT 1 FROM boletos_metas_gasto WHERE id = 2')).toBeDefined();
    });

    it('depois de removida, o resumo perde o máximo/saldo daquela semana', async () => {
      await request(env.app).delete(`${ROTA}/metas/1`).set(auth(U.gerenteA)).expect(200);
      const res = await request(env.app).get(`${ROTA}/resumo?restaurante_id=1`).set(auth(U.gerenteA)).expect(200);
      expect(res.body.semanas.map((s) => s.chave)).toEqual(['20261024.20261030']);
    });

    it('400 "id inválido"; 404 "Meta não encontrada"; 403 em meta de outro restaurante (nada removido)', async () => {
      expect((await request(env.app).delete(`${ROTA}/metas/abc`).set(auth(U.admin)).expect(400)).body).toEqual({ error: 'id inválido' });
      expect((await request(env.app).delete(`${ROTA}/metas/999`).set(auth(U.admin)).expect(404)).body).toEqual({ error: 'Meta não encontrada' });
      expect((await request(env.app).delete(`${ROTA}/metas/2`).set(auth(U.gerenteA)).expect(403)).body).toEqual({
        error: 'Sem permissão para os boletos deste restaurante.'
      });
      expect(await nMetas()).toBe(2);
    });

    it('403 sem módulo', async () => {
      await request(env.app).delete(`${ROTA}/metas/1`).set(auth(U.semModulo)).expect(403);
      expect(await nMetas()).toBe(2);
    });
  });

  describe('rotas /metas e /resumo não colidem com :id', () => {
    it('GET /api/boletos/metas e /resumo respondem como listas, não como id inválido', async () => {
      const metas = await request(env.app).get(`${ROTA}/metas?restaurante_id=1`).set(auth(U.admin)).expect(200);
      const resumo = await request(env.app).get(`${ROTA}/resumo?restaurante_id=1`).set(auth(U.admin)).expect(200);
      expect(Array.isArray(metas.body)).toBe(true);
      expect(Array.isArray(resumo.body.semanas)).toBe(true);
    });
  });
});
