/**
 * requireModuloBoletos com falha no banco ao ler as flags: responde 500 (ou 503 em 42P01) e nunca pendura.
 */
const request = require('supertest');
const { usarBancoReal, auth, U } = require('./helpers/setup');

const env = usarBancoReal();

function falharLeituraDeFlags(erro) {
  const original = env.pool.query.bind(env.pool);
  return jest.spyOn(env.pool, 'query').mockImplementation((sql, params) => {
    if (typeof sql === 'string' && sql.includes('FROM usuarios WHERE id = $1') && sql.includes('pode_marcar_pago')) {
      return Promise.reject(erro);
    }
    return original(sql, params);
  });
}

describe('requireModuloBoletos: falha ao ler as flags', () => {
  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  it('erro genérico do banco => 500 (resposta enviada, sem pendurar) e sem vazar detalhes', async () => {
    const spy = falharLeituraDeFlags(new Error('connection terminated: segredo-interno'));
    const res = await request(env.app).get('/api/boletos?restaurante_id=1').set(auth(U.gerenteA)).expect(500);
    expect(spy).toHaveBeenCalled();
    expect(JSON.stringify(res.body)).not.toContain('segredo-interno');
    expect(res.body.error).toBeTruthy();
  });

  it('tabela inexistente (42P01) => 503 de banco desatualizado', async () => {
    const e = Object.assign(new Error('relation "usuarios" does not exist'), { code: '42P01' });
    falharLeituraDeFlags(e);
    const res = await request(env.app).get('/api/boletos?restaurante_id=1').set(auth(U.gerenteA)).expect(503);
    expect(res.body.error).toMatch(/migrations pendentes/);
  });

  it('vale também para escrita e para o admin: nada é gravado', async () => {
    falharLeituraDeFlags(new Error('boom'));
    await request(env.app)
      .post('/api/boletos')
      .set(auth(U.admin))
      .send({ restaurante_id: 1, descricao: 'x', valor: 1, tipo: 'Boleto', dt_recebimento: '2026-10-20', dt_vencimento: '2026-11-05' })
      .expect(500);
    jest.restoreAllMocks();
    expect(Number((await env.um('SELECT count(*) AS n FROM boletos_notas')).n)).toBe(2);
  });

  it('sem falha (controle): a mesma rota responde 200', async () => {
    await request(env.app).get('/api/boletos?restaurante_id=1').set(auth(U.gerenteA)).expect(200);
  });
});
