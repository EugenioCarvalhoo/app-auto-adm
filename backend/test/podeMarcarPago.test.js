/** Flag pode_marcar_pago: gestão pelo admin e exposição em login/verify (Postgres real). */
const request = require('supertest');
const { usarBancoReal, auth, U } = require('./helpers/setup');

const env = usarBancoReal();
const ROTA = '/api/admin/usuarios-permissoes';
const flagDe = async (id) => (await env.um('SELECT pode_marcar_pago FROM usuarios WHERE id = $1', [id])).pode_marcar_pago;
const novo = (extra = {}) => ({ username: 'novo', password: 'abcd1234', nome: 'Novo', modulo_boletos: true, restaurante_ids: [1], ...extra });

describe('pode_marcar_pago', () => {
  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  describe('permissões (admin)', () => {
    it('POST cria com a flag verdadeira; omitida => false', async () => {
      const a = await request(env.app).post(ROTA).set(auth(U.admin)).send(novo({ pode_marcar_pago: true })).expect(201);
      expect(a.body.pode_marcar_pago).toBe(true);
      expect(await flagDe(a.body.id)).toBe(true);
      const b = await request(env.app).post(ROTA).set(auth(U.admin)).send(novo({ username: 'novo2' })).expect(201);
      expect(b.body.pode_marcar_pago).toBe(false);
      expect(await flagDe(b.body.id)).toBe(false);
    });

    it('POST só aceita true estrito (string "true" vira false)', async () => {
      const r = await request(env.app).post(ROTA).set(auth(U.admin)).send(novo({ pode_marcar_pago: 'true' })).expect(201);
      expect(await flagDe(r.body.id)).toBe(false);
    });

    it('GET lista a flag; admin aparece com true; padrão false', async () => {
      await env.rows('UPDATE usuarios SET pode_marcar_pago = true WHERE id = 3');
      const res = await request(env.app).get(ROTA).set(auth(U.admin)).expect(200);
      const por = Object.fromEntries(res.body.map((u) => [u.username, u.pode_marcar_pago]));
      expect(por).toMatchObject({ admin: true, gerenteA: false, gerenteB: true });
    });

    it('PUT altera a flag e a resposta confirma', async () => {
      const res = await request(env.app).put(`${ROTA}/2`).set(auth(U.admin)).send({ modulo_boletos: true, restaurante_ids: [1], pode_marcar_pago: true }).expect(200);
      expect(res.body.pode_marcar_pago).toBe(true);
      expect(await flagDe(2)).toBe(true);
      await request(env.app).put(`${ROTA}/2`).set(auth(U.admin)).send({ modulo_boletos: true, restaurante_ids: [1], pode_marcar_pago: false }).expect(200);
      expect(await flagDe(2)).toBe(false);
    });

    it('PUT sem a flag mantém o valor atual', async () => {
      await env.rows('UPDATE usuarios SET pode_marcar_pago = true WHERE id = 2');
      const res = await request(env.app).put(`${ROTA}/2`).set(auth(U.admin)).send({ modulo_boletos: true, restaurante_ids: [1] }).expect(200);
      expect(res.body.pode_marcar_pago).toBe(true);
      expect(await flagDe(2)).toBe(true);
    });

    it('PUT com valor não booleano => 400 e a flag não muda', async () => {
      await request(env.app).put(`${ROTA}/2`).set(auth(U.admin)).send({ modulo_boletos: true, restaurante_ids: [1], pode_marcar_pago: 'sim' }).expect(400);
      expect(await flagDe(2)).toBe(false);
    });

    it('usuário comum não consegue se conceder a flag (403) nem via POST/PUT', async () => {
      await request(env.app).put(`${ROTA}/2`).set(auth(U.gerenteA)).send({ modulo_boletos: true, restaurante_ids: [1], pode_marcar_pago: true }).expect(403);
      expect(await flagDe(2)).toBe(false);
    });

    it('revogar a flag vale na hora para marcar pago', async () => {
      await request(env.app).put(`${ROTA}/2`).set(auth(U.admin)).send({ modulo_boletos: true, restaurante_ids: [1], pode_marcar_pago: true }).expect(200);
      await request(env.app).post('/api/boletos/10/pago').set(auth(U.gerenteA)).expect(200);
      await request(env.app).put(`${ROTA}/2`).set(auth(U.admin)).send({ modulo_boletos: true, restaurante_ids: [1], pode_marcar_pago: false }).expect(200);
      await env.rows('UPDATE boletos_notas SET pago = false WHERE id = 10');
      await request(env.app).post('/api/boletos/10/pago').set(auth(U.gerenteA)).expect(403);
    });
  });

  describe('login e verify', () => {
    it('login devolve pode_marcar_pago: admin true, comum conforme o banco', async () => {
      const admin = await request(env.app).post('/api/login').send({ username: 'admin', password: 'senha123' }).expect(200);
      expect(admin.body.user.pode_marcar_pago).toBe(true);
      const a1 = await request(env.app).post('/api/login').send({ username: 'gerenteA', password: 'senha123' }).expect(200);
      expect(a1.body.user.pode_marcar_pago).toBe(false);
      await env.rows('UPDATE usuarios SET pode_marcar_pago = true WHERE id = 2');
      const a2 = await request(env.app).post('/api/login').send({ username: 'gerenteA', password: 'senha123' }).expect(200);
      expect(a2.body.user.pode_marcar_pago).toBe(true);
    });

    it('verify devolve o valor atual do banco', async () => {
      const antes = await request(env.app).get('/api/verify').set(auth(U.gerenteA)).expect(200);
      expect(antes.body.user.pode_marcar_pago).toBe(false);
      await env.rows('UPDATE usuarios SET pode_marcar_pago = true WHERE id = 2');
      const depois = await request(env.app).get('/api/verify').set(auth(U.gerenteA)).expect(200);
      expect(depois.body.user.pode_marcar_pago).toBe(true);
      const admin = await request(env.app).get('/api/verify').set(auth(U.admin)).expect(200);
      expect(admin.body.user.pode_marcar_pago).toBe(true);
    });
  });
});
