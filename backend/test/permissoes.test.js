/** Gestão de usuários e permissões (/api/admin/usuarios-permissoes): somente admin (Postgres real). */
const request = require('supertest');
const bcrypt = require('bcryptjs');
const { usarBancoReal, auth, U } = require('./helpers/setup');

const env = usarBancoReal();

const ROTA = '/api/admin/usuarios-permissoes';
const novoUsuario = (extra = {}) => ({
  username: 'novo',
  password: 'abcd1234',
  nome: 'Novo Usuário',
  modulo_boletos: true,
  restaurante_ids: [1],
  ...extra
});
const vinculosDe = async (uid) =>
  (await env.rows('SELECT restaurante_id FROM usuario_restaurantes WHERE usuario_id = $1 ORDER BY 1', [uid])).map(
    (r) => r.restaurante_id
  );

describe('permissões de usuários', () => {
  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  describe('acesso restrito ao admin', () => {
    it('401 sem token', async () => {
      await request(env.app).get(ROTA).expect(401);
    });

    it.each([
      ['gerenteA', U.gerenteA],
      ['financeiroLegado', U.financeiroLegado]
    ])('%s recebe 403 em todas as rotas', async (_n, usuario) => {
      await request(env.app).get(ROTA).set(auth(usuario)).expect(403);
      await request(env.app).post(ROTA).set(auth(usuario)).send(novoUsuario()).expect(403);
      await request(env.app).put(`${ROTA}/3`).set(auth(usuario)).send({ modulo_boletos: true, restaurante_ids: [1, 2] }).expect(403);
      await request(env.app).delete(`${ROTA}/3`).set(auth(usuario)).expect(403);
    });

    it('usuário comum não consegue se auto-conceder acesso a outro restaurante', async () => {
      await request(env.app).put(`${ROTA}/2`).set(auth(U.gerenteA)).send({ modulo_boletos: true, restaurante_ids: [1, 2] }).expect(403);
      expect(await vinculosDe(2)).toEqual([1]);
    });
  });

  describe('GET', () => {
    it('lista usuários com módulos e restaurantes, sem expor senha', async () => {
      const res = await request(env.app).get(ROTA).set(auth(U.admin)).expect(200);
      expect(res.body).toHaveLength(6);
      const gerenteA = res.body.find((u) => u.username === 'gerenteA');
      expect(gerenteA).toMatchObject({ modulo_boletos: true, restaurante_ids: [1] });
      expect(JSON.stringify(res.body)).not.toMatch(/password|\$2[aby]\$/);
    });

    it('admin aparece com todos os módulos', async () => {
      const res = await request(env.app).get(ROTA).set(auth(U.admin)).expect(200);
      expect(res.body.find((u) => u.is_admin)).toMatchObject({ modulo_boletos: true, modulo_financeiro: true });
    });
  });

  describe('POST (criar usuário)', () => {
    it('cria usuário comum, com senha em hash e vínculo ao restaurante', async () => {
      const res = await request(env.app).post(ROTA).set(auth(U.admin)).send(novoUsuario()).expect(201);
      expect(res.body).toMatchObject({ username: 'novo', is_admin: false, modulo_boletos: true, restaurante_ids: [1] });
      const salvo = await env.um("SELECT * FROM usuarios WHERE username = 'novo'");
      expect(salvo.password).not.toBe('abcd1234');
      expect(await bcrypt.compare('abcd1234', salvo.password)).toBe(true);
      expect(salvo.is_admin).toBe(false);
    });

    it('nunca cria administrador, mesmo que o corpo peça', async () => {
      await request(env.app).post(ROTA).set(auth(U.admin)).send(novoUsuario({ is_admin: true })).expect(201);
      expect((await env.um("SELECT is_admin FROM usuarios WHERE username = 'novo'")).is_admin).toBe(false);
    });

    it('exige restaurante liberado mesmo para quem tem o antigo modulo_financeiro', async () => {
      await request(env.app).post(ROTA).set(auth(U.admin)).send(novoUsuario({ modulo_financeiro: true, restaurante_ids: [] })).expect(400);
    });

    it('exige ao menos um módulo, login, senha (>= 4) e nome', async () => {
      await request(env.app).post(ROTA).set(auth(U.admin)).send(novoUsuario({ modulo_boletos: false })).expect(400);
      await request(env.app).post(ROTA).set(auth(U.admin)).send(novoUsuario({ username: ' ' })).expect(400);
      await request(env.app).post(ROTA).set(auth(U.admin)).send(novoUsuario({ password: 'abc' })).expect(400);
      await request(env.app).post(ROTA).set(auth(U.admin)).send(novoUsuario({ nome: '' })).expect(400);
    });

    it('409 para login duplicado', async () => {
      await request(env.app).post(ROTA).set(auth(U.admin)).send(novoUsuario({ username: 'gerenteA' })).expect(409);
    });

    it('sem nenhum restaurante válido: 400 e a transação desfaz a criação do usuário (sem órfão)', async () => {
      const res = await request(env.app).post(ROTA).set(auth(U.admin)).send(novoUsuario({ restaurante_ids: [3, 999] }));
      expect(res.status).toBe(400);
      expect(await env.um("SELECT id FROM usuarios WHERE username = 'novo'")).toBeUndefined();
    });

    it('vincula apenas os restaurantes válidos da lista (ignora inativo e inexistente)', async () => {
      const res = await request(env.app).post(ROTA).set(auth(U.admin)).send(novoUsuario({ restaurante_ids: [1, 3, 2, 999] })).expect(201);
      expect(res.body.restaurante_ids).toEqual([1, 2]);
      expect(await vinculosDe(res.body.id)).toEqual([1, 2]);
    });

    it('o novo usuário consegue entrar e enxerga só o restaurante liberado', async () => {
      await request(env.app).post(ROTA).set(auth(U.admin)).send(novoUsuario({ restaurante_ids: [2] })).expect(201);
      jest.spyOn(console, 'log').mockImplementation(() => {});
      const login = await request(env.app).post('/api/login').send({ username: 'novo', password: 'abcd1234' }).expect(200);
      const token = { Authorization: `Bearer ${login.body.token}` };
      const rest = await request(env.app).get('/api/restaurantes').set(token).expect(200);
      expect(rest.body.map((r) => r.id)).toEqual([2]);
      await request(env.app).get('/api/boletos?restaurante_id=1').set(token).expect(403);
      await request(env.app).get('/api/boletos?restaurante_id=2').set(token).expect(200);
    });
  });

  describe('PUT (alterar permissões)', () => {
    it('admin libera mais um restaurante e o acesso passa a valer na hora', async () => {
      await request(env.app).get('/api/boletos?restaurante_id=2').set(auth(U.gerenteA)).expect(403);
      const res = await request(env.app).put(`${ROTA}/2`).set(auth(U.admin)).send({ modulo_boletos: true, restaurante_ids: [1, 2] }).expect(200);
      expect(res.body.restaurante_ids).toEqual([1, 2]);
      await request(env.app).get('/api/boletos?restaurante_id=2').set(auth(U.gerenteA)).expect(200);
    });

    it('admin revoga restaurante e o acesso cai na hora', async () => {
      await request(env.app).put(`${ROTA}/2`).set(auth(U.admin)).send({ modulo_boletos: true, restaurante_ids: [2] }).expect(200);
      await request(env.app).get('/api/boletos?restaurante_id=1').set(auth(U.gerenteA)).expect(403);
      expect(await vinculosDe(2)).toEqual([2]);
    });

    it('admin revoga o módulo de boletos e o acesso cai na hora', async () => {
      await request(env.app).put(`${ROTA}/2`).set(auth(U.admin)).send({ modulo_financeiro: true, restaurante_ids: [1] }).expect(200);
      await request(env.app).get('/api/boletos?restaurante_id=1').set(auth(U.gerenteA)).expect(403);
    });

    it('sem restaurante_ids no corpo, mantém os vínculos atuais', async () => {
      const res = await request(env.app).put(`${ROTA}/2`).set(auth(U.admin)).send({ modulo_boletos: true }).expect(200);
      expect(res.body.restaurante_ids).toEqual([1]);
    });

    it('lista de restaurantes vazia é rejeitada (não vira acesso a todos) e preserva os vínculos', async () => {
      await request(env.app).put(`${ROTA}/2`).set(auth(U.admin)).send({ modulo_boletos: true, restaurante_ids: [] }).expect(400);
      expect(await vinculosDe(2)).toEqual([1]);
    });

    it('exige ao menos um módulo', async () => {
      await request(env.app).put(`${ROTA}/2`).set(auth(U.admin)).send({ restaurante_ids: [1] }).expect(400);
    });

    it('não altera permissões de administrador; 404 e 400 nos casos inválidos', async () => {
      await request(env.app).put(`${ROTA}/1`).set(auth(U.admin)).send({ modulo_boletos: false }).expect(400);
      await request(env.app).put(`${ROTA}/999`).set(auth(U.admin)).send({ modulo_boletos: true, restaurante_ids: [1] }).expect(404);
      await request(env.app).put(`${ROTA}/abc`).set(auth(U.admin)).send({}).expect(400);
    });
  });

  describe('DELETE', () => {
    it('admin remove usuário comum e os vínculos dele; boletos que ele criou permanecem', async () => {
      await request(env.app).delete(`${ROTA}/2`).set(auth(U.admin)).expect(200);
      expect(await env.um('SELECT id FROM usuarios WHERE id = 2')).toBeUndefined();
      expect(await vinculosDe(2)).toEqual([]);
      const boleto = await env.um('SELECT id, usuario_id FROM boletos_notas WHERE id = 10');
      expect(boleto).toBeDefined();
      expect(boleto.usuario_id).toBeNull();
    });

    it('não remove a si mesmo nem outro administrador', async () => {
      await request(env.app).delete(`${ROTA}/1`).set(auth(U.admin)).expect(400);
      await env.rows("INSERT INTO usuarios (id, username, password, nome, is_admin) VALUES (50, 'admin2', 'x', 'A2', true)");
      await request(env.app).delete(`${ROTA}/50`).set(auth(U.admin)).expect(400);
      expect(await env.um('SELECT id FROM usuarios WHERE id = 50')).toBeDefined();
    });

    it('404 para usuário inexistente', async () => {
      await request(env.app).delete(`${ROTA}/999`).set(auth(U.admin)).expect(404);
    });

    it('token de usuário removido deixa de dar acesso (token antigo válido por 24h)', async () => {
      const headers = auth(U.gerenteA);
      await request(env.app).delete(`${ROTA}/2`).set(auth(U.admin)).expect(200);
      await request(env.app).get('/api/boletos?restaurante_id=1').set(headers).expect(403);
    });
  });
});
