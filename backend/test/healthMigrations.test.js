/** Readiness com verificação de migrations (Postgres real, tudo migrado) e helper ehTabelaInexistente. */
const request = require('supertest');
const { usarBancoReal } = require('./helpers/setup');
const { ehTabelaInexistente, MSG_BANCO_DESATUALIZADO } = require('../lib/erros');

const env = usarBancoReal();
const ARQUIVO = '017_remove_legado_gastos_estoque.sql';

describe('GET /api/health/ready e migrations', () => {
  it('200 com migrations: ok quando tudo está aplicado', async () => {
    const res = await request(env.app).get('/api/health/ready').expect(200);
    expect(res.body).toMatchObject({ status: 'ok', database: 'connected', migrations: 'ok' });
  });

  it('503 listando a pendente quando falta uma migration em schema_migrations; liveness segue 200', async () => {
    const linha = await env.um('SELECT filename, applied_at FROM schema_migrations WHERE filename = $1', [ARQUIVO]);
    expect(linha).toBeDefined();
    try {
      await env.rows('DELETE FROM schema_migrations WHERE filename = $1', [ARQUIVO]);

      const res = await request(env.app).get('/api/health/ready').expect(503);
      expect(res.body).toMatchObject({ status: 'error', database: 'connected', migrations: 'pending' });
      expect(res.body.pendentes).toEqual([ARQUIVO]);
      expect(res.body.error).toMatch(/migrations pendentes/i);
      expect(res.body.error).toContain(ARQUIVO);

      // /health (probe antigo) também reflete a pendência
      await request(env.app).get('/health').expect(503);

      const live = await request(env.app).get('/api/health').expect(200);
      expect(live.body).toMatchObject({ status: 'ok', check: 'liveness' });
    } finally {
      await env.rows('INSERT INTO schema_migrations (filename, applied_at) VALUES ($1, $2) ON CONFLICT DO NOTHING', [
        linha.filename,
        linha.applied_at
      ]);
    }
    await request(env.app).get('/api/health/ready').expect(200);
  });

  it('liveness não consulta o banco', async () => {
    const spy = jest.spyOn(env.pool, 'query');
    await request(env.app).get('/api/health').expect(200);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('ehTabelaInexistente', () => {
  it('true só para SQLSTATE 42P01', () => {
    expect(ehTabelaInexistente(Object.assign(new Error('relation "x" does not exist'), { code: '42P01' }))).toBe(true);
    expect(ehTabelaInexistente(Object.assign(new Error('x'), { code: '23505' }))).toBe(false);
    expect(ehTabelaInexistente(new Error('relation does not exist'))).toBe(false);
    expect(ehTabelaInexistente(null)).toBe(false);
    expect(ehTabelaInexistente('42P01')).toBe(false);
  });

  it('o erro real do Postgres para tabela inexistente é reconhecido', async () => {
    const erro = await env.pool.query('SELECT 1 FROM tabela_que_nao_existe').catch((e) => e);
    expect(ehTabelaInexistente(erro)).toBe(true);
  });

  it('a mensagem padrão menciona migrations pendentes', () => {
    expect(MSG_BANCO_DESATUALIZADO).toMatch(/^Banco desatualizado: migrations pendentes/);
  });
});
