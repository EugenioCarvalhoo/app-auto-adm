/** Boletos e metas: CRUD, validações e isolamento por restaurante (Postgres real). */
const request = require('supertest');
const { usarBancoReal, auth, U } = require('./helpers/setup');

const env = usarBancoReal();

const boletoValido = (extra = {}) => ({
  restaurante_id: 1,
  descricao: 'Hortifruti',
  valor: '150,75',
  tipo: 'Boleto',
  dt_recebimento: '2026-10-20',
  dt_vencimento: '2026-11-05',
  ...extra
});

const contarBoletos = async () => Number((await env.um('SELECT count(*) AS n FROM boletos_notas')).n);

describe('boletos', () => {
  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  describe('autorização de módulo', () => {
    it('401 sem token', async () => {
      await request(env.app).get('/api/boletos?restaurante_id=1').expect(401);
    });

    it('403 para usuário sem modulo_boletos, mesmo vinculado ao restaurante', async () => {
      await request(env.app).get('/api/boletos?restaurante_id=1').set(auth(U.semModulo)).expect(403);
      await request(env.app).post('/api/boletos').set(auth(U.semModulo)).send(boletoValido()).expect(403);
    });

    it('400 sem restaurante_id', async () => {
      await request(env.app).get('/api/boletos').set(auth(U.admin)).expect(400);
      await request(env.app).get('/api/boletos/resumo').set(auth(U.admin)).expect(400);
    });
  });

  describe('isolamento por restaurante — leitura', () => {
    it('admin lê qualquer restaurante', async () => {
      const a = await request(env.app).get('/api/boletos?restaurante_id=1').set(auth(U.admin)).expect(200);
      const b = await request(env.app).get('/api/boletos?restaurante_id=2').set(auth(U.admin)).expect(200);
      expect(a.body).toHaveLength(1);
      expect(b.body).toHaveLength(1);
    });

    it('usuário lê somente o restaurante vinculado', async () => {
      const res = await request(env.app).get('/api/boletos?restaurante_id=1').set(auth(U.gerenteA)).expect(200);
      expect(res.body.map((b) => b.id)).toEqual([10]);
    });

    it('usuário NÃO lê boletos de outro restaurante (403)', async () => {
      await request(env.app).get('/api/boletos?restaurante_id=2').set(auth(U.gerenteA)).expect(403);
      await request(env.app).get('/api/boletos/resumo?restaurante_id=2').set(auth(U.gerenteA)).expect(403);
      await request(env.app).get('/api/boletos/metas?restaurante_id=2').set(auth(U.gerenteA)).expect(403);
    });

    it('usuário sem nenhum vínculo não lê nada', async () => {
      await request(env.app).get('/api/boletos?restaurante_id=1').set(auth(U.semVinculo)).expect(403);
      await request(env.app).get('/api/boletos?restaurante_id=2').set(auth(U.semVinculo)).expect(403);
    });

    it('antigo modulo_financeiro não dá mais acesso a restaurantes não vinculados', async () => {
      await request(env.app).get('/api/boletos?restaurante_id=1').set(auth(U.financeiroLegado)).expect(200);
      await request(env.app).get('/api/boletos?restaurante_id=2').set(auth(U.financeiroLegado)).expect(403);
    });

    it('restaurante_id não numérico é rejeitado', async () => {
      await request(env.app).get('/api/boletos?restaurante_id=abc').set(auth(U.admin)).expect(400);
    });

    it('a resposta nunca mistura boletos de restaurantes diferentes', async () => {
      const res = await request(env.app).get('/api/boletos?restaurante_id=2').set(auth(U.gerenteB)).expect(200);
      expect(res.body.every((b) => b.restaurante_id === 2)).toBe(true);
    });
  });

  describe('isolamento por restaurante — escrita (IDOR)', () => {
    it('não cria boleto em restaurante não vinculado', async () => {
      await request(env.app).post('/api/boletos').set(auth(U.gerenteA)).send(boletoValido({ restaurante_id: 2 })).expect(403);
      expect(await contarBoletos()).toBe(2);
    });

    it('não edita boleto de outro restaurante pelo id', async () => {
      await request(env.app).put('/api/boletos/20').set(auth(U.gerenteA)).send({ descricao: 'Hack' }).expect(403);
      expect((await env.um('SELECT descricao FROM boletos_notas WHERE id = 20')).descricao).toBe('Fornecedor B');
    });

    it('não apaga boleto de outro restaurante pelo id', async () => {
      await request(env.app).delete('/api/boletos/20').set(auth(U.gerenteA)).expect(403);
      expect(await env.um('SELECT id FROM boletos_notas WHERE id = 20')).toBeDefined();
    });

    it('não altera meta de outro restaurante', async () => {
      await request(env.app).post('/api/boletos/metas').set(auth(U.gerenteA)).send({ restaurante_id: 2, data_referencia: '2026-10-20', maximo_gasto: 1 }).expect(403);
      await request(env.app).put('/api/boletos/metas/2').set(auth(U.gerenteA)).send({ maximo_gasto: 1 }).expect(403);
      await request(env.app).delete('/api/boletos/metas/2').set(auth(U.gerenteA)).expect(403);
      expect(Number((await env.um('SELECT maximo_gasto FROM boletos_metas_gasto WHERE id = 2')).maximo_gasto)).toBe(2000);
    });

    it('usuário não consegue "mover" boleto para outro restaurante enviando restaurante_id no PUT', async () => {
      await request(env.app).put('/api/boletos/10').set(auth(U.gerenteA)).send({ restaurante_id: 2, descricao: 'ok' }).expect(200);
      expect((await env.um('SELECT restaurante_id FROM boletos_notas WHERE id = 10')).restaurante_id).toBe(1);
    });

    it('admin pode escrever em qualquer restaurante', async () => {
      await request(env.app).post('/api/boletos').set(auth(U.admin)).send(boletoValido({ restaurante_id: 2 })).expect(201);
      await request(env.app).put('/api/boletos/20').set(auth(U.admin)).send({ descricao: 'Ajustado' }).expect(200);
    });
  });

  describe('criação e validação', () => {
    it('cria boleto no restaurante vinculado, gravando o usuário e convertendo o valor', async () => {
      const res = await request(env.app).post('/api/boletos').set(auth(U.gerenteA)).send(boletoValido()).expect(201);
      expect(res.body).toMatchObject({ restaurante_id: 1, descricao: 'Hortifruti', valor: 150.75, tipo: 'Boleto' });
      const salvo = await env.um('SELECT usuario_id, valor FROM boletos_notas WHERE id = $1', [res.body.id]);
      expect(salvo.usuario_id).toBe(2);
      expect(Number(salvo.valor)).toBe(150.75);
    });

    it('as datas gravadas voltam iguais, sem deslocar um dia por fuso horário', async () => {
      const res = await request(env.app)
        .post('/api/boletos')
        .set(auth(U.gerenteA))
        .send(boletoValido({ dt_recebimento: '2026-10-20', dt_vencimento: '2026-11-05' }))
        .expect(201);
      const lista = await request(env.app).get('/api/boletos?restaurante_id=1').set(auth(U.gerenteA)).expect(200);
      const criado = lista.body.find((b) => b.id === res.body.id);
      expect(String(criado.dt_recebimento).slice(0, 10)).toBe('2026-10-20');
      expect(String(criado.dt_vencimento).slice(0, 10)).toBe('2026-11-05');
    });

    it('descrição é obrigatória', async () => {
      await request(env.app).post('/api/boletos').set(auth(U.gerenteA)).send(boletoValido({ descricao: '   ' })).expect(400);
    });

    it.each(['abc', '', null, undefined])('valor inválido (%p) é rejeitado', async (valor) => {
      await request(env.app).post('/api/boletos').set(auth(U.gerenteA)).send(boletoValido({ valor })).expect(400);
    });

    it('boleto exige data de vencimento', async () => {
      await request(env.app).post('/api/boletos').set(auth(U.gerenteA)).send(boletoValido({ dt_vencimento: null })).expect(400);
    });

    it('"Sem Boleto" não grava vencimento e assume a data de hoje no recebimento', async () => {
      const res = await request(env.app)
        .post('/api/boletos')
        .set(auth(U.gerenteA))
        .send(boletoValido({ tipo: 'Sem Boleto', dt_recebimento: undefined, dt_vencimento: '2026-12-01' }))
        .expect(201);
      expect(res.body.tipo).toBe('Sem Boleto');
      const salvo = await env.um('SELECT dt_vencimento, dt_recebimento FROM boletos_notas WHERE id = $1', [res.body.id]);
      expect(salvo.dt_vencimento).toBeNull();
      expect(salvo.dt_recebimento).toBeInstanceOf(Date);
    });

    it('data de recebimento impossível (31/02) é rejeitada com 400, não 500', async () => {
      await request(env.app).post('/api/boletos').set(auth(U.gerenteA)).send(boletoValido({ dt_recebimento: '2026-02-31' })).expect(400);
    });

    it('valor acima do limite do banco (NUMERIC 14,2) é rejeitado com 400, não 500', async () => {
      await request(env.app).post('/api/boletos').set(auth(U.gerenteA)).send(boletoValido({ valor: '99999999999999999' })).expect(400);
      await request(env.app).post('/api/boletos/metas').set(auth(U.gerenteA)).send({ restaurante_id: 1, data_referencia: '2026-10-20', maximo_gasto: '1000000000000' }).expect(400);
    });

    it('aceita o maior valor que o banco comporta', async () => {
      await request(env.app).post('/api/boletos').set(auth(U.gerenteA)).send(boletoValido({ valor: '999999999999.99' })).expect(201);
    });

    it('valor negativo é rejeitado', async () => {
      await request(env.app).post('/api/boletos').set(auth(U.gerenteA)).send(boletoValido({ valor: '-5' })).expect(400);
    });
  });

  describe('edição e exclusão', () => {
    it('edita parcialmente, mantendo os demais campos', async () => {
      const res = await request(env.app).put('/api/boletos/10').set(auth(U.gerenteA)).send({ valor: 300 }).expect(200);
      expect(res.body.valor).toBe(300);
      expect(res.body.descricao).toBe('Fornecedor A');
    });

    it('404 em boleto inexistente; 400 em id inválido', async () => {
      await request(env.app).put('/api/boletos/999').set(auth(U.admin)).send({ valor: 1 }).expect(404);
      await request(env.app).delete('/api/boletos/999').set(auth(U.admin)).expect(404);
      await request(env.app).put('/api/boletos/abc').set(auth(U.admin)).send({}).expect(400);
    });

    it('usuário comum exclui lançamento criado há menos de 1 dia', async () => {
      await request(env.app).delete('/api/boletos/10').set(auth(U.gerenteA)).expect(200);
      expect(await env.um('SELECT id FROM boletos_notas WHERE id = 10')).toBeUndefined();
    });

    it('usuário comum NÃO exclui lançamento com mais de 1 dia; admin exclui', async () => {
      await env.rows("UPDATE boletos_notas SET created_at = now() - interval '3 days' WHERE id = 10");
      await request(env.app).delete('/api/boletos/10').set(auth(U.gerenteA)).expect(403);
      expect(await env.um('SELECT id FROM boletos_notas WHERE id = 10')).toBeDefined();
      await request(env.app).delete('/api/boletos/10').set(auth(U.admin)).expect(200);
      expect(await env.um('SELECT id FROM boletos_notas WHERE id = 10')).toBeUndefined();
    });
  });

  describe('resumo semanal e metas', () => {
    it('soma por semana de vencimento (sáb–sex) e calcula o saldo contra a meta, em centavos', async () => {
      // a semana da meta (17/10 a 23/10) é decidida pelo vencimento efetivo, não pelo recebimento
      await env.rows("UPDATE boletos_notas SET dt_vencimento = '2026-10-21' WHERE id = 10");
      await env.rows(
        `INSERT INTO boletos_notas (restaurante_id, usuario_id, dt_recebimento, dt_vencimento, descricao, valor, tipo) VALUES
           (1, 2, '2026-10-20', '2026-10-22', 'x', 0.10, 'Boleto'),
           (1, 2, '2026-10-20', '2026-10-23', 'y', 0.20, 'Boleto')`
      );
      const res = await request(env.app).get('/api/boletos/resumo?restaurante_id=1').set(auth(U.gerenteA)).expect(200);
      const semana = res.body.semanas.find((s) => s.maximo === 1000);
      expect(semana).toBeDefined();
      expect(semana.total).toBe(100.8); // 100.50 + 0.10 + 0.20, sem erro de ponto flutuante
      expect(semana.saldo).toBe(899.2);
      expect(res.body.total_geral).toBe(100.8);
    });

    it('o resumo não inclui valores de outro restaurante', async () => {
      const res = await request(env.app).get('/api/boletos/resumo?restaurante_id=1').set(auth(U.gerenteA)).expect(200);
      expect(res.body.total_geral).toBe(100.5);
    });

    it('cria meta no restaurante vinculado e atualiza (upsert) na mesma semana', async () => {
      const corpo = { restaurante_id: 1, data_referencia: '2026-10-21', maximo_gasto: '500' };
      const primeira = await request(env.app).post('/api/boletos/metas').set(auth(U.gerenteA)).send(corpo).expect(201);
      const segunda = await request(env.app).post('/api/boletos/metas').set(auth(U.gerenteA)).send({ ...corpo, maximo_gasto: '700' }).expect(201);
      expect(segunda.body.id).toBe(primeira.body.id);
      const metas = await env.rows('SELECT maximo_gasto FROM boletos_metas_gasto WHERE restaurante_id = 1');
      expect(metas).toHaveLength(1);
      expect(Number(metas[0].maximo_gasto)).toBe(700);
    });

    it('meta de semana diferente cria nova linha', async () => {
      await request(env.app).post('/api/boletos/metas').set(auth(U.gerenteA)).send({ restaurante_id: 1, data_referencia: '2026-11-04', maximo_gasto: '300' }).expect(201);
      const metas = await env.rows('SELECT id FROM boletos_metas_gasto WHERE restaurante_id = 1');
      expect(metas).toHaveLength(2);
    });

    it('meta exige data e máximo válidos', async () => {
      await request(env.app).post('/api/boletos/metas').set(auth(U.gerenteA)).send({ restaurante_id: 1, maximo_gasto: 1 }).expect(400);
      await request(env.app).post('/api/boletos/metas').set(auth(U.gerenteA)).send({ restaurante_id: 1, data_referencia: '2026-10-20', maximo_gasto: 'abc' }).expect(400);
    });

    it('lista metas apenas do restaurante pedido', async () => {
      const res = await request(env.app).get('/api/boletos/metas?restaurante_id=1').set(auth(U.gerenteA)).expect(200);
      expect(res.body.every((m) => m.restaurante_id === 1)).toBe(true);
    });
  });
});
