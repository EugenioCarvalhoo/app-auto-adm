/** Restaurantes: só o admin gerencia; os demais só enxergam os vinculados (Postgres real). */
const request = require('supertest');
const { usarBancoReal, auth, U } = require('./helpers/setup');

const env = usarBancoReal();

describe('restaurantes', () => {
  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  describe('GET /api/restaurantes', () => {
    it('401 sem token', async () => {
      await request(env.app).get('/api/restaurantes').expect(401);
    });

    it('admin vê todos os restaurantes ativos', async () => {
      const res = await request(env.app).get('/api/restaurantes').set(auth(U.admin)).expect(200);
      expect(res.body.map((r) => r.id).sort()).toEqual([1, 2]);
    });

    it('usuário comum vê só o restaurante vinculado', async () => {
      const a = await request(env.app).get('/api/restaurantes').set(auth(U.gerenteA)).expect(200);
      expect(a.body.map((r) => r.id)).toEqual([1]);
      const b = await request(env.app).get('/api/restaurantes').set(auth(U.gerenteB)).expect(200);
      expect(b.body.map((r) => r.id)).toEqual([2]);
    });

    it('usuário com antigo modulo_financeiro NÃO vê todos (regra nova)', async () => {
      const res = await request(env.app).get('/api/restaurantes').set(auth(U.financeiroLegado)).expect(200);
      expect(res.body.map((r) => r.id)).toEqual([1]);
    });

    it('usuário sem vínculo recebe lista vazia', async () => {
      const res = await request(env.app).get('/api/restaurantes').set(auth(U.semVinculo)).expect(200);
      expect(res.body).toEqual([]);
    });

    it('restaurante inativo não aparece nem para o admin', async () => {
      const res = await request(env.app).get('/api/restaurantes').set(auth(U.admin)).expect(200);
      expect(res.body.find((r) => r.id === 3)).toBeUndefined();
    });

    it('restaurante inativo não aparece nem para quem está vinculado a ele', async () => {
      await env.rows('INSERT INTO usuario_restaurantes (usuario_id, restaurante_id) VALUES (2, 3)');
      const res = await request(env.app).get('/api/restaurantes').set(auth(U.gerenteA)).expect(200);
      expect(res.body.map((r) => r.id)).toEqual([1]);
    });
  });

  describe('GET /api/restaurantes/:id', () => {
    it('admin acessa qualquer restaurante', async () => {
      await request(env.app).get('/api/restaurantes/2').set(auth(U.admin)).expect(200);
    });

    it('usuário comum acessa o vinculado', async () => {
      await request(env.app).get('/api/restaurantes/1').set(auth(U.gerenteA)).expect(200);
    });

    it('usuário comum recebe 403 em restaurante não vinculado', async () => {
      await request(env.app).get('/api/restaurantes/2').set(auth(U.gerenteA)).expect(403);
    });

    it('usuário com antigo modulo_financeiro recebe 403 em restaurante não vinculado', async () => {
      await request(env.app).get('/api/restaurantes/2').set(auth(U.financeiroLegado)).expect(403);
    });

    it('404 para restaurante inexistente (admin)', async () => {
      await request(env.app).get('/api/restaurantes/999').set(auth(U.admin)).expect(404);
    });
  });

  describe('criar, editar e desativar: somente admin', () => {
    it('admin cria restaurante', async () => {
      const res = await request(env.app).post('/api/restaurantes').set(auth(U.admin)).send({ nome: 'Novo' }).expect(201);
      expect(res.body.nome).toBe('Novo');
      expect(await env.um("SELECT id FROM restaurantes WHERE nome = 'Novo'")).toBeDefined();
    });

    it('admin: nome obrigatório', async () => {
      await request(env.app).post('/api/restaurantes').set(auth(U.admin)).send({ nome: '  ' }).expect(400);
    });

    it.each([
      ['gerenteA', U.gerenteA],
      ['financeiroLegado', U.financeiroLegado],
      ['semVinculo', U.semVinculo]
    ])('%s não cria restaurante (403)', async (_nome, usuario) => {
      await request(env.app).post('/api/restaurantes').set(auth(usuario)).send({ nome: 'Invasor' }).expect(403);
      expect(await env.um("SELECT id FROM restaurantes WHERE nome = 'Invasor'")).toBeUndefined();
    });

    it('usuário comum não edita nem o restaurante em que está vinculado', async () => {
      await request(env.app).put('/api/restaurantes/1').set(auth(U.gerenteA)).send({ nome: 'Hack' }).expect(403);
      expect((await env.um('SELECT nome FROM restaurantes WHERE id = 1')).nome).toBe('Restaurante A');
    });

    it('usuário comum não desativa restaurante', async () => {
      await request(env.app).delete('/api/restaurantes/1').set(auth(U.gerenteA)).expect(403);
      expect((await env.um('SELECT ativo FROM restaurantes WHERE id = 1')).ativo).toBe(true);
    });

    it('admin edita e desativa (soft delete)', async () => {
      await request(env.app).put('/api/restaurantes/1').set(auth(U.admin)).send({ nome: 'Renomeado' }).expect(200);
      expect((await env.um('SELECT nome FROM restaurantes WHERE id = 1')).nome).toBe('Renomeado');
      await request(env.app).delete('/api/restaurantes/2').set(auth(U.admin)).expect(200);
      expect((await env.um('SELECT ativo FROM restaurantes WHERE id = 2')).ativo).toBe(false);
    });

    it('404 ao editar/desativar restaurante inexistente', async () => {
      await request(env.app).put('/api/restaurantes/999').set(auth(U.admin)).send({ nome: 'x' }).expect(404);
      await request(env.app).delete('/api/restaurantes/999').set(auth(U.admin)).expect(404);
    });
  });
});
