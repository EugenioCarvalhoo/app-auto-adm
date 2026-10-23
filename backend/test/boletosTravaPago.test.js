/**
 * Trava de boleto pago: PUT/DELETE /api/boletos/:id => 403 para não-admin; admin passa.
 * Ordem das checagens: 404 e acesso ao restaurante vêm ANTES do 403 de "pago". Postgres real.
 */
const request = require('supertest');
const { usarBancoReal, auth, U } = require('./helpers/setup');

const env = usarBancoReal();

const MSG = /Boleto pago: peça ao administrador/;
const put = (usuario, id, corpo) => request(env.app).put(`/api/boletos/${id}`).set(auth(usuario)).send(corpo);
const del = (usuario, id) => request(env.app).delete(`/api/boletos/${id}`).set(auth(usuario));
const marcarPago = (id) => env.rows('UPDATE boletos_notas SET pago = true, pago_em = now(), pago_por_usuario_id = 1 WHERE id = $1', [id]);
const linha = (id) => env.um('SELECT descricao, valor, deleted_at FROM boletos_notas WHERE id = $1', [id]);

describe('trava de boleto pago (PUT/DELETE)', () => {
  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  describe('PUT', () => {
    it('não-admin vinculado => 403 com a mensagem e nada muda', async () => {
      await marcarPago(10);
      const res = await put(U.gerenteA, 10, { descricao: 'Mudou', valor: 1 }).expect(403);
      expect(res.body.error).toMatch(MSG);
      const l = await linha(10);
      expect(l.descricao).toBe('Fornecedor A');
      expect(Number(l.valor)).toBe(100.5);
    });

    it('não pago: o mesmo usuário edita normalmente (controle: o 403 vem do pago)', async () => {
      await put(U.gerenteA, 10, { descricao: 'Mudou' }).expect(200);
      expect((await linha(10)).descricao).toBe('Mudou');
    });

    it('admin edita boleto pago e ele continua pago', async () => {
      await marcarPago(10);
      await put(U.admin, 10, { descricao: 'Admin mudou' }).expect(200);
      const r = await env.um('SELECT descricao, pago FROM boletos_notas WHERE id = 10');
      expect(r).toEqual({ descricao: 'Admin mudou', pago: true });
    });

    it('a trava usa o banco: virar admin depois de emitir o token libera; perder o pago também', async () => {
      await marcarPago(10);
      const headers = auth(U.gerenteA);
      await request(env.app).put('/api/boletos/10').set(headers).send({ descricao: 'x' }).expect(403);
      await env.rows('UPDATE usuarios SET is_admin = true WHERE id = 2');
      await request(env.app).put('/api/boletos/10').set(headers).send({ descricao: 'x' }).expect(200);
    });

    it('ordem: inexistente => 404 antes do 403 de pago', async () => {
      await put(U.gerenteA, 9999, { descricao: 'x' }).expect(404);
    });

    it('ordem: restaurante alheio e pago => 403 de ACESSO (não revela o estado de pago)', async () => {
      await marcarPago(20);
      const res = await put(U.gerenteA, 20, { descricao: 'x' }).expect(403);
      expect(res.body.error).not.toMatch(MSG);
      expect((await linha(20)).descricao).toBe('Fornecedor B');
    });

    it('ordem: boleto excluído (mesmo pago) => 404', async () => {
      await marcarPago(10);
      await env.rows('UPDATE boletos_notas SET deleted_at = now() WHERE id = 10');
      await put(U.gerenteA, 10, { descricao: 'x' }).expect(404);
    });
  });

  describe('DELETE', () => {
    it('não-admin vinculado => 403 com a mensagem, mesmo recém-criado; nada é excluído', async () => {
      await marcarPago(10);
      const res = await del(U.gerenteA, 10).expect(403);
      expect(res.body.error).toMatch(MSG);
      expect((await linha(10)).deleted_at).toBeNull();
    });

    it('admin exclui boleto pago', async () => {
      await marcarPago(10);
      await del(U.admin, 10).expect(200);
      const l = await env.um('SELECT deleted_at, deleted_by_usuario_id FROM boletos_notas WHERE id = 10');
      expect(l.deleted_at).toBeInstanceOf(Date);
      expect(l.deleted_by_usuario_id).toBe(1);
    });

    it('não pago com mais de 1 dia segue 403 (mensagem antiga) para não-admin', async () => {
      await env.rows("UPDATE boletos_notas SET created_at = now() - interval '3 days' WHERE id = 10");
      const res = await del(U.gerenteA, 10).expect(403);
      expect(res.body.error).toMatch(/mais de 1 dia/);
      expect(res.body.error).not.toMatch(MSG);
      expect((await linha(10)).deleted_at).toBeNull();
    });

    it('ordem: inexistente => 404; restaurante alheio e pago => 403 de acesso', async () => {
      await del(U.gerenteA, 9999).expect(404);
      await marcarPago(20);
      const res = await del(U.gerenteA, 20).expect(403);
      expect(res.body.error).not.toMatch(MSG);
      expect((await linha(20)).deleted_at).toBeNull();
    });

    it('desfazer o pagamento (admin) devolve a edição/exclusão ao usuário comum', async () => {
      await marcarPago(10);
      await del(U.gerenteA, 10).expect(403);
      await request(env.app).delete('/api/boletos/10/pago').set(auth(U.admin)).send({ motivo: 'Pago por engano' }).expect(200);
      await put(U.gerenteA, 10, { descricao: 'Liberado' }).expect(200);
      await del(U.gerenteA, 10).expect(200);
    });
  });
});
