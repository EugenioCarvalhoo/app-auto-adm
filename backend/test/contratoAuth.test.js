/** Contrato de /api/login, /login e /api/verify: corpos exatos de sucesso e de erro. */
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { usarBancoReal, auth, U, JWT_SECRET } = require('./helpers/setup');

const env = usarBancoReal();

const CHAVES_USUARIO = ['id', 'is_admin', 'modulo_boletos', 'nome', 'restaurante_ids', 'username'];
const login = (corpo, rota = '/api/login') => request(env.app).post(rota).send(corpo);

describe('contrato de autenticação', () => {
  beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  describe.each(['/api/login', '/login'])('POST %s', (rota) => {
    it('200: corpo { token, user } com as chaves exatas do usuário', async () => {
      const res = await login({ username: 'gerenteA', password: 'senha123' }, rota).expect(200);
      expect(res.headers['content-type']).toMatch(/application\/json/);
      expect(Object.keys(res.body).sort()).toEqual(['token', 'user']);
      expect(Object.keys(res.body.user).sort()).toEqual(CHAVES_USUARIO);
      expect(res.body.user).toEqual({
        id: 2,
        username: 'gerenteA',
        nome: 'Fulano',
        is_admin: false,
        modulo_boletos: true,
        restaurante_ids: [1]
      });
    });

    it('200: admin recebe restaurante_ids vazio (admin vê tudo, não precisa de vínculo)', async () => {
      const res = await login({ username: 'admin', password: 'senha123' }, rota).expect(200);
      expect(res.body.user).toEqual({
        id: 1,
        username: 'admin',
        nome: 'Fulano',
        is_admin: true,
        modulo_boletos: true,
        restaurante_ids: []
      });
    });

    it('200: usuário sem módulo recebe modulo_boletos false', async () => {
      const res = await login({ username: 'semModulo', password: 'senha123' }, rota).expect(200);
      expect(res.body.user).toMatchObject({ is_admin: false, modulo_boletos: false, restaurante_ids: [1] });
    });

    it('400 { error } sem username ou sem password (ou vazios)', async () => {
      for (const corpo of [{}, { username: 'admin' }, { password: 'x' }, { username: '', password: 'x' }, { username: 'admin', password: '' }]) {
        const res = await login(corpo, rota).expect(400);
        expect(res.body).toEqual({ error: 'Username e senha são obrigatórios' });
      }
    });

    it('401 { error: "Credenciais inválidas" } para usuário inexistente e para senha errada', async () => {
      const a = await login({ username: 'ninguem', password: 'senha123' }, rota).expect(401);
      const b = await login({ username: 'admin', password: 'errada' }, rota).expect(401);
      expect(a.body).toEqual({ error: 'Credenciais inválidas' });
      expect(b.body).toEqual({ error: 'Credenciais inválidas' });
    });

    it('o login diferencia maiúsculas/minúsculas no username', async () => {
      await login({ username: 'ADMIN', password: 'senha123' }, rota).expect(401);
    });

    it('login não grava nada no banco de usuários', async () => {
      const antes = await env.rows('SELECT id, password, updated_at FROM usuarios ORDER BY id');
      await login({ username: 'admin', password: 'senha123' }, rota).expect(200);
      expect(await env.rows('SELECT id, password, updated_at FROM usuarios ORDER BY id')).toEqual(antes);
    });
  });

  it('token do login: payload com id, username, is_admin, modulo_boletos e validade de 24h', async () => {
    const res = await login({ username: 'gerenteB', password: 'senha123' }).expect(200);
    const payload = jwt.verify(res.body.token, JWT_SECRET);
    expect(Object.keys(payload).sort()).toEqual(['exp', 'iat', 'id', 'is_admin', 'modulo_boletos', 'username']);
    expect(payload).toMatchObject({ id: 3, username: 'gerenteB', is_admin: false, modulo_boletos: true });
    expect(payload.exp - payload.iat).toBe(24 * 60 * 60);
  });

  it('o token do login serve imediatamente em rota protegida', async () => {
    const res = await login({ username: 'gerenteA', password: 'senha123' }).expect(200);
    await request(env.app)
      .get('/api/boletos?restaurante_id=1')
      .set('Authorization', `Bearer ${res.body.token}`)
      .expect(200);
  });

  it('login lê flags do banco: módulo revogado aparece como false no perfil e no token', async () => {
    await env.rows('UPDATE usuarios SET modulo_boletos = false WHERE id = 2');
    const res = await login({ username: 'gerenteA', password: 'senha123' }).expect(200);
    expect(res.body.user.modulo_boletos).toBe(false);
    expect(jwt.decode(res.body.token).modulo_boletos).toBe(false);
  });

  it('login ignora vínculos com restaurante inativo? (comportamento atual: o id do vínculo continua listado)', async () => {
    await env.rows('INSERT INTO usuario_restaurantes (usuario_id, restaurante_id) VALUES (2, 3)');
    const res = await login({ username: 'gerenteA', password: 'senha123' }).expect(200);
    expect(res.body.user.restaurante_ids).toEqual([1, 3]);
  });

  // BUG DE PRODUCAO (reportado): password que não é string (ex.: número) faz bcrypt.compare lançar e a API
  // responde 500 "Erro ao fazer login"; o esperado é 400/401. `it.failing`: remova o `.failing` quando corrigido.
  it.failing('BUG: password numérico no JSON deveria ser 400/401, não 500', async () => {
    const res = await login({ username: 'admin', password: 12345 });
    expect(res.status).toBeLessThan(500);
  });

  describe('GET /api/verify', () => {
    it('200: corpo { user } com as chaves exatas', async () => {
      const res = await request(env.app).get('/api/verify').set(auth(U.gerenteA)).expect(200);
      expect(Object.keys(res.body)).toEqual(['user']);
      expect(res.body.user).toEqual({
        id: 2,
        username: 'gerenteA',
        nome: 'Fulano',
        is_admin: false,
        modulo_boletos: true,
        restaurante_ids: [1]
      });
    });

    it('200: reflete o banco, não o token (admin do token sem is_admin vira o que está no banco)', async () => {
      await env.rows('UPDATE usuarios SET nome = $1 WHERE id = 3', ['Nome Novo']);
      await env.rows('INSERT INTO usuario_restaurantes (usuario_id, restaurante_id) VALUES (3, 1)');
      const res = await request(env.app).get('/api/verify').set(auth(U.gerenteB)).expect(200);
      expect(res.body.user).toMatchObject({ nome: 'Nome Novo', restaurante_ids: [1, 2] });
    });

    it('404 { error: "Usuário não encontrado" } quando o usuário não existe mais', async () => {
      const res = await request(env.app).get('/api/verify').set(auth({ id: 999, username: 'x' })).expect(404);
      expect(res.body).toEqual({ error: 'Usuário não encontrado' });
    });

    it('não vaza o hash da senha', async () => {
      const res = await request(env.app).get('/api/verify').set(auth(U.admin)).expect(200);
      expect(JSON.stringify(res.body)).not.toMatch(/password|\$2[aby]\$/);
    });
  });
});
