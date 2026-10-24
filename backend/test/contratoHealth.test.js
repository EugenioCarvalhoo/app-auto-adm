/** Contrato dos endpoints de saúde: liveness, readiness e o alias /health (sem autenticação). */
const request = require('supertest');
const { usarBancoReal } = require('./helpers/setup');
const { MIGRATIONS } = require('../database/lista-migrations');

const env = usarBancoReal();

describe('contrato de health', () => {
  afterEach(() => jest.restoreAllMocks());

  describe('GET /api/health (liveness)', () => {
    it('200 com as chaves exatas e tipos corretos; não exige token', async () => {
      const res = await request(env.app).get('/api/health').expect(200);
      expect(res.headers['content-type']).toMatch(/application\/json/);
      expect(Object.keys(res.body).sort()).toEqual(['check', 'hint', 'service', 'status', 'timestamp', 'uptimeSeconds']);
      expect(res.body).toMatchObject({
        status: 'ok',
        check: 'liveness',
        service: 'controle-financeiro-api',
        hint: 'GET /api/health/ready para testar conexão com o banco.'
      });
      expect(Number.isInteger(res.body.uptimeSeconds)).toBe(true);
      expect(res.body.uptimeSeconds).toBeGreaterThanOrEqual(0);
      expect(new Date(res.body.timestamp).toISOString()).toBe(res.body.timestamp);
    });

    it('segue 200 mesmo com o banco fora do ar', async () => {
      jest.spyOn(env.pool, 'query').mockRejectedValue(new Error('banco caiu'));
      await request(env.app).get('/api/health').expect(200);
    });
  });

  describe.each(['/api/health/ready', '/health'])('GET %s (readiness)', (rota) => {
    it('200 com as chaves exatas quando o banco responde e as migrations estão em dia', async () => {
      const res = await request(env.app).get(rota).expect(200);
      expect(Object.keys(res.body).sort()).toEqual(['check', 'database', 'migrations', 'status', 'timestamp']);
      expect(res.body).toMatchObject({ status: 'ok', check: 'ready', database: 'connected', migrations: 'ok' });
      expect(new Date(res.body.timestamp).toISOString()).toBe(res.body.timestamp);
    });

    it('503 database:"disconnected" com a mensagem do erro quando o banco falha', async () => {
      jest.spyOn(env.pool, 'query').mockRejectedValue(new Error('connection refused'));
      const res = await request(env.app).get(rota).expect(503);
      expect(res.body).toEqual({ status: 'error', check: 'ready', database: 'disconnected', error: 'connection refused' });
    });

    it('503 migrations:"pending" com as chaves exatas e a lista de pendentes em ordem', async () => {
      const aplicadas = await env.rows('SELECT filename, applied_at FROM schema_migrations');
      const alvo = MIGRATIONS.slice(-2);
      try {
        await env.rows('DELETE FROM schema_migrations WHERE filename = ANY($1)', [alvo]);
        const res = await request(env.app).get(rota).expect(503);
        expect(Object.keys(res.body).sort()).toEqual(['check', 'database', 'error', 'migrations', 'pendentes', 'status']);
        expect(res.body).toEqual({
          status: 'error',
          check: 'ready',
          database: 'connected',
          migrations: 'pending',
          pendentes: alvo,
          error: `Migrations pendentes: ${alvo.join(', ')}`
        });
      } finally {
        for (const l of aplicadas.filter((a) => alvo.includes(a.filename))) {
          await env.rows('INSERT INTO schema_migrations (filename, applied_at) VALUES ($1, $2) ON CONFLICT DO NOTHING', [l.filename, l.applied_at]);
        }
      }
      await request(env.app).get(rota).expect(200);
    });

    it('sem a tabela schema_migrations, todas as migrations aparecem como pendentes (503)', async () => {
      await env.rows('ALTER TABLE schema_migrations RENAME TO schema_migrations_off');
      try {
        const res = await request(env.app).get(rota).expect(503);
        expect(res.body).toMatchObject({ status: 'error', migrations: 'pending', database: 'connected' });
        expect(res.body.pendentes).toEqual(MIGRATIONS);
      } finally {
        await env.rows('ALTER TABLE schema_migrations_off RENAME TO schema_migrations');
      }
    });
  });

  it('readiness não exige token (sem 401 mesmo sem Authorization)', async () => {
    await request(env.app).get('/api/health/ready').expect(200);
  });
});
