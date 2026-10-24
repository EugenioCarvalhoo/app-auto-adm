/**
 * Contrato transversal da API: CORS/preflight, formato JSON dos erros de autenticação/autorização,
 * variações do cabeçalho Authorization, JSON malformado e rota desconhecida.
 * Rede de segurança para a migração (Express -> NestJS): nada aqui pode mudar.
 */
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { usarBancoReal, auth, tokenDe, U, JWT_SECRET } = require('./helpers/setup');

const env = usarBancoReal();

const JSON_CT = /application\/json/;

/** Todas as rotas protegidas por token (método, caminho). */
const ROTAS_PROTEGIDAS = [
  ['get', '/api/verify'],
  ['get', '/api/restaurantes'],
  ['get', '/api/restaurantes/1'],
  ['post', '/api/restaurantes'],
  ['put', '/api/restaurantes/1'],
  ['delete', '/api/restaurantes/1'],
  ['get', '/api/boletos?restaurante_id=1'],
  ['get', '/api/boletos/resumo?restaurante_id=1'],
  ['get', '/api/boletos/metas?restaurante_id=1'],
  ['post', '/api/boletos'],
  ['post', '/api/boletos/metas'],
  ['put', '/api/boletos/10'],
  ['put', '/api/boletos/metas/1'],
  ['delete', '/api/boletos/10'],
  ['delete', '/api/boletos/metas/1'],
  ['get', '/api/admin/usuarios-permissoes'],
  ['post', '/api/admin/usuarios-permissoes'],
  ['put', '/api/admin/usuarios-permissoes/2'],
  ['delete', '/api/admin/usuarios-permissoes/2']
];

describe('contrato comum', () => {
  beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  describe('CORS', () => {
    it('resposta normal libera qualquer origem e envia Allow-Credentials', async () => {
      const res = await request(env.app).get('/api/health').set('Origin', 'https://app.exemplo.com').expect(200);
      expect(res.headers['access-control-allow-origin']).toBe('*');
      expect(res.headers['access-control-allow-credentials']).toBe('true');
    });

    it('sem cabeçalho Origin o CORS continua respondendo normalmente', async () => {
      const res = await request(env.app).get('/api/health').expect(200);
      expect(res.headers['access-control-allow-origin']).toBe('*');
    });

    it('preflight OPTIONS responde 204 com métodos, cabeçalhos refletidos e max-age de 1 dia', async () => {
      const res = await request(env.app)
        .options('/api/boletos')
        .set('Origin', 'https://app.exemplo.com')
        .set('Access-Control-Request-Method', 'POST')
        .set('Access-Control-Request-Headers', 'authorization,content-type')
        .expect(204);
      expect(res.headers['access-control-allow-origin']).toBe('*');
      expect(res.headers['access-control-allow-credentials']).toBe('true');
      expect(res.headers['access-control-allow-methods']).toBe('GET,HEAD,PUT,PATCH,POST,DELETE');
      expect(res.headers['access-control-allow-headers']).toBe('authorization,content-type');
      expect(res.headers['access-control-max-age']).toBe('86400');
      expect(res.text).toBe('');
    });

    it('preflight não exige token (não devolve 401)', async () => {
      await request(env.app)
        .options('/api/admin/usuarios-permissoes')
        .set('Origin', 'https://app.exemplo.com')
        .set('Access-Control-Request-Method', 'DELETE')
        .expect(204);
    });

    it('erros 401/403 também levam os cabeçalhos de CORS', async () => {
      const r401 = await request(env.app).get('/api/boletos?restaurante_id=1').set('Origin', 'https://x.com').expect(401);
      expect(r401.headers['access-control-allow-origin']).toBe('*');
      const r403 = await request(env.app).get('/api/admin/usuarios-permissoes').set('Origin', 'https://x.com').set(auth(U.gerenteA)).expect(403);
      expect(r403.headers['access-control-allow-origin']).toBe('*');
    });
  });

  describe('autenticação por token em todas as rotas protegidas', () => {
    it.each(ROTAS_PROTEGIDAS)('%s %s: 401 JSON sem token', async (metodo, caminho) => {
      const res = await request(env.app)[metodo](caminho).send({}).expect(401);
      expect(res.headers['content-type']).toMatch(JSON_CT);
      expect(res.body).toEqual({ error: 'Token de acesso não fornecido' });
    });

    it.each(ROTAS_PROTEGIDAS)('%s %s: 403 JSON com token inválido', async (metodo, caminho) => {
      const res = await request(env.app)[metodo](caminho).set('Authorization', 'Bearer lixo').send({}).expect(403);
      expect(res.headers['content-type']).toMatch(JSON_CT);
      expect(res.body).toEqual({ error: 'Token inválido ou expirado' });
    });

    it('token expirado: 403 com a mesma mensagem do inválido', async () => {
      const res = await request(env.app)
        .get('/api/verify')
        .set('Authorization', `Bearer ${tokenDe(U.admin, { expiresIn: -10 })}`)
        .expect(403);
      expect(res.body).toEqual({ error: 'Token inválido ou expirado' });
    });

    it('token sem assinatura (alg none) é rejeitado', async () => {
      const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
      const semAssinatura = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ id: 1, is_admin: true })}.`;
      await request(env.app).get('/api/admin/usuarios-permissoes').set('Authorization', `Bearer ${semAssinatura}`).expect(403);
    });

    it('token assinado com outro algoritmo da mesma chave (HS512) ainda é aceito (comportamento atual)', async () => {
      const t = jwt.sign({ id: 1, username: 'admin', is_admin: true }, JWT_SECRET, { algorithm: 'HS512', expiresIn: '1h' });
      await request(env.app).get('/api/verify').set('Authorization', `Bearer ${t}`).expect(200);
    });

    it('cabeçalho "Bearer" sem token: 401', async () => {
      const res = await request(env.app).get('/api/verify').set('Authorization', 'Bearer').expect(401);
      expect(res.body).toEqual({ error: 'Token de acesso não fornecido' });
    });

    it('cabeçalho Authorization vazio: 401', async () => {
      await request(env.app).get('/api/verify').set('Authorization', '').expect(401);
    });

    it('o prefixo do esquema não é conferido: qualquer "Esquema <jwt>" é aceito (comportamento atual)', async () => {
      await request(env.app).get('/api/verify').set('Authorization', `Token ${tokenDe(U.gerenteA)}`).expect(200);
    });

    it('token sem o segundo segmento ("Bearer" + token com espaço extra) usa só a 2ª palavra', async () => {
      await request(env.app).get('/api/verify').set('Authorization', `Bearer  ${tokenDe(U.gerenteA)}`).expect(401);
    });

    it('cabeçalho Authorization em minúsculas/maiúsculas variadas funciona (HTTP é case-insensitive)', async () => {
      await request(env.app).get('/api/verify').set('authorization', `Bearer ${tokenDe(U.gerenteA)}`).expect(200);
    });
  });

  describe('mensagens de autorização', () => {
    it('rotas de admin: 403 "Apenas administradores..." para usuário comum', async () => {
      const res = await request(env.app).get('/api/admin/usuarios-permissoes').set(auth(U.gerenteA)).expect(403);
      expect(res.body).toEqual({ error: 'Apenas administradores podem realizar esta ação.' });
      const r2 = await request(env.app).post('/api/restaurantes').set(auth(U.gerenteA)).send({ nome: 'x' }).expect(403);
      expect(r2.body).toEqual({ error: 'Apenas administradores podem realizar esta ação.' });
    });

    it('boletos: 403 "Sem permissão para o módulo..." sem modulo_boletos', async () => {
      const res = await request(env.app).get('/api/boletos?restaurante_id=1').set(auth(U.semModulo)).expect(403);
      expect(res.body).toEqual({ error: 'Sem permissão para o módulo de boletos e notas.' });
    });

    it('boletos: 403 "Sem permissão para os boletos deste restaurante." em restaurante não vinculado', async () => {
      const res = await request(env.app).get('/api/boletos?restaurante_id=2').set(auth(U.gerenteA)).expect(403);
      expect(res.body).toEqual({ error: 'Sem permissão para os boletos deste restaurante.' });
    });

    it('token válido de usuário que não existe mais: 403 "Usuário inválido." em boletos e restaurantes', async () => {
      const fantasma = { id: 999, username: 'fantasma', is_admin: false };
      const b = await request(env.app).get('/api/boletos?restaurante_id=1').set(auth(fantasma)).expect(403);
      expect(b.body).toEqual({ error: 'Usuário inválido.' });
      const r = await request(env.app).get('/api/restaurantes').set(auth(fantasma)).expect(403);
      expect(r.body).toEqual({ error: 'Usuário inválido.' });
    });
  });

  describe('administração pelo JWT (requireAdmin lê is_admin do token)', () => {
    it('token de admin sem o campo is_admin é tratado como não-admin (403), mesmo o usuário sendo admin no banco', async () => {
      const t = jwt.sign({ id: 1, username: 'admin' }, JWT_SECRET, { expiresIn: '1h' });
      await request(env.app).get('/api/admin/usuarios-permissoes').set('Authorization', `Bearer ${t}`).expect(403);
    });

    // BUG DE PRODUCAO CONHECIDO (reportado ao backend-api): requireAdmin confia no is_admin do JWT em vez de
    // reler o banco, ao contrário do que o CLAUDE.md diz sobre as flags. Um admin rebaixado no banco continua
    // administrando por até 24h. `it.failing` passa enquanto o bug existe e FALHA quando for corrigido:
    // nesse dia, troque por `it` normal.
    it.failing('BUG: admin rebaixado no banco deveria perder o acesso às rotas de admin na hora', async () => {
      const headers = auth(U.admin);
      await env.rows('UPDATE usuarios SET is_admin = false WHERE id = 1');
      await request(env.app).get('/api/admin/usuarios-permissoes').set(headers).expect(403);
    });
  });

  describe('corpo e rotas inexistentes', () => {
    it('JSON malformado: 400', async () => {
      const res = await request(env.app)
        .post('/api/login')
        .set('Content-Type', 'application/json')
        .send('{"username": ')
        .expect(400);
      expect(res.status).toBe(400);
    });

    it('rota desconhecida: 404', async () => {
      await request(env.app).get('/api/nao-existe').expect(404);
      await request(env.app).post('/api/nao-existe').send({}).expect(404);
    });

    it('rotas legadas removidas continuam inexistentes (404, sem token)', async () => {
      await request(env.app).get('/api/gastos').expect(404);
      await request(env.app).get('/api/estoque/produtos').expect(404);
    });

    it('método não previsto em rota existente: 404', async () => {
      await request(env.app).patch('/api/boletos/10').set(auth(U.admin)).send({}).expect(404);
      await request(env.app).put('/api/verify').set(auth(U.admin)).send({}).expect(404);
    });

    it('corpo urlencoded é aceito no login', async () => {
      const res = await request(env.app).post('/api/login').type('form').send({ username: 'admin', password: 'senha123' }).expect(200);
      expect(res.body.token).toEqual(expect.any(String));
    });

    it('aceita corpo JSON grande (limite de 50mb, aqui ~2mb)', async () => {
      const res = await request(env.app)
        .post('/api/login')
        .send({ username: 'admin', password: 'senha123', lixo: 'x'.repeat(2 * 1024 * 1024) })
        .expect(200);
      expect(res.body.token).toBeDefined();
    });
  });
});
