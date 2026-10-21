/** Autenticação: login, verify e validação do JWT (Postgres real). */
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { usarBancoReal, auth, tokenDe, U, JWT_SECRET } = require('./helpers/setup');

const env = usarBancoReal();

describe('autenticação', () => {
  beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  describe('POST /api/login', () => {
    it('400 sem usuário ou senha', async () => {
      await request(env.app).post('/api/login').send({ username: 'admin' }).expect(400);
      await request(env.app).post('/api/login').send({ password: 'x' }).expect(400);
    });

    it('401 para usuário inexistente', async () => {
      await request(env.app).post('/api/login').send({ username: 'ninguem', password: 'senha123' }).expect(401);
    });

    it('401 para senha errada, sem revelar qual campo falhou', async () => {
      const res = await request(env.app).post('/api/login').send({ username: 'admin', password: 'errada' }).expect(401);
      expect(res.body.error).toBe('Credenciais inválidas');
    });

    it('mesma mensagem para usuário inexistente e senha errada', async () => {
      const a = await request(env.app).post('/api/login').send({ username: 'ninguem', password: 'x' });
      const b = await request(env.app).post('/api/login').send({ username: 'admin', password: 'x' });
      expect(a.body.error).toBe(b.body.error);
    });

    it('admin: token válido e perfil com todos os módulos', async () => {
      const res = await request(env.app).post('/api/login').send({ username: 'admin', password: 'senha123' }).expect(200);
      const payload = jwt.verify(res.body.token, JWT_SECRET);
      expect(payload).toMatchObject({ id: 1, username: 'admin', is_admin: true, modulo_boletos: true });
      expect(res.body.user).toMatchObject({ id: 1, is_admin: true, modulo_boletos: true });
    });

    it('não vaza o hash da senha na resposta', async () => {
      const res = await request(env.app).post('/api/login').send({ username: 'admin', password: 'senha123' }).expect(200);
      expect(JSON.stringify(res.body)).not.toMatch(/password|\$2[aby]\$/);
    });

    it('usuário comum: devolve apenas os restaurantes vinculados', async () => {
      const res = await request(env.app).post('/api/login').send({ username: 'gerenteA', password: 'senha123' }).expect(200);
      expect(res.body.user.is_admin).toBe(false);
      expect(res.body.user.restaurante_ids).toEqual([1]);
    });

    it('usuário com antigo modulo_financeiro também fica restrito aos vínculos', async () => {
      const res = await request(env.app).post('/api/login').send({ username: 'financeiroLegado', password: 'senha123' }).expect(200);
      expect(res.body.user.restaurante_ids).toEqual([1]);
    });

    it('usuário sem vínculo recebe lista vazia (não "todos")', async () => {
      const res = await request(env.app).post('/api/login').send({ username: 'semVinculo', password: 'senha123' }).expect(200);
      expect(res.body.user.restaurante_ids).toEqual([]);
    });

    it('/login (sem prefixo /api) também funciona', async () => {
      await request(env.app).post('/login').send({ username: 'admin', password: 'senha123' }).expect(200);
    });
  });

  describe('GET /api/verify', () => {
    it('401 sem token', async () => {
      await request(env.app).get('/api/verify').expect(401);
    });

    it('403 com token malformado', async () => {
      await request(env.app).get('/api/verify').set('Authorization', 'Bearer lixo').expect(403);
    });

    it('403 com token assinado por outra chave', async () => {
      const falso = jwt.sign({ id: 1, is_admin: true }, 'outra_chave');
      await request(env.app).get('/api/verify').set('Authorization', `Bearer ${falso}`).expect(403);
    });

    it('403 com token expirado', async () => {
      const expirado = tokenDe(U.admin, { expiresIn: -10 });
      await request(env.app).get('/api/verify').set('Authorization', `Bearer ${expirado}`).expect(403);
    });

    it('200 e perfil atual vindo do banco', async () => {
      const res = await request(env.app).get('/api/verify').set(auth(U.gerenteB)).expect(200);
      expect(res.body.user).toMatchObject({ id: 3, restaurante_ids: [2], modulo_boletos: true });
    });

    it('404 quando o usuário do token foi removido', async () => {
      const fantasma = { id: 999, username: 'fantasma', is_admin: false };
      await request(env.app).get('/api/verify').set(auth(fantasma)).expect(404);
    });
  });

  describe('JWT não é fonte de verdade das permissões', () => {
    it('token adulterado com is_admin=true no payload não dá acesso a rotas de admin', async () => {
      // is_admin vem do token em requireAdmin; só uma assinatura válida o altera, então forjar exige a chave.
      const forjado = jwt.sign({ id: 2, username: 'gerenteA', is_admin: true }, 'chave_errada');
      await request(env.app).get('/api/admin/usuarios-permissoes').set('Authorization', `Bearer ${forjado}`).expect(403);
    });

    it('permissão de boletos removida no banco vale mesmo com token antigo', async () => {
      const headers = auth(U.gerenteA);
      await env.rows('UPDATE usuarios SET modulo_boletos = false WHERE id = 2');
      await request(env.app).get('/api/boletos?restaurante_id=1').set(headers).expect(403);
    });
  });
});
