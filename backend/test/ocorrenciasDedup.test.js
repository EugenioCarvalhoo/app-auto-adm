/**
 * Deduplicação de ocorrências "linha_duplicada": tentativas repetidas e ainda não vistas viram 1 registro.
 * Postgres real.
 */
const request = require('supertest');
const { usarBancoReal, auth, U } = require('./helpers/setup');
const { linha47 } = require('./helpers/linhas');

const env = usarBancoReal();

const L1 = linha47(1);
const L2 = linha47(2);

const corpo = (extra = {}) => ({
  restaurante_id: 1,
  descricao: 'Tentativa',
  valor: '10,00',
  tipo: 'Boleto',
  dt_recebimento: '2026-10-20',
  dt_vencimento: '2026-11-05',
  ...extra
});
const post = (usuario, c) => request(env.app).post('/api/boletos').set(auth(usuario)).send(c);
const ocorrencias = () => env.rows('SELECT * FROM boletos_ocorrencias ORDER BY id');

describe('ocorrências de linha duplicada: deduplicação', () => {
  beforeEach(async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    // boleto existente com L1 e L2 no restaurante B
    await post(U.gerenteB, corpo({ restaurante_id: 2, linha_digitavel: L1 })).expect(201);
    await post(U.gerenteB, corpo({ restaurante_id: 2, descricao: 'Segundo', linha_digitavel: L2 })).expect(201);
  });
  afterEach(() => jest.restoreAllMocks());

  it('duas tentativas iguais (mesmo usuário, restaurante e linha) => 409 nas duas, 1 ocorrência', async () => {
    await post(U.gerenteA, corpo({ linha_digitavel: L1 })).expect(409);
    await post(U.gerenteA, corpo({ linha_digitavel: L1 })).expect(409);
    const oc = await ocorrencias();
    expect(oc).toHaveLength(1);
    expect(oc[0]).toMatchObject({ usuario_id: 2, restaurante_id: 1, linha_digitavel: L1, visto_em: null });
  });

  it('a mesma linha com máscara conta como a mesma tentativa', async () => {
    await post(U.gerenteA, corpo({ linha_digitavel: L1 })).expect(409);
    const mascarada = `${L1.slice(0, 5)}.${L1.slice(5, 10)} ${L1.slice(10)}`;
    await post(U.gerenteA, corpo({ linha_digitavel: mascarada })).expect(409);
    expect(await ocorrencias()).toHaveLength(1);
  });

  it('se a primeira já foi vista, uma nova ocorrência é criada', async () => {
    await post(U.gerenteA, corpo({ linha_digitavel: L1 })).expect(409);
    await env.rows('UPDATE boletos_ocorrencias SET visto_em = now(), visto_por_usuario_id = 1');
    await post(U.gerenteA, corpo({ linha_digitavel: L1 })).expect(409);
    const oc = await ocorrencias();
    expect(oc).toHaveLength(2);
    expect(oc[0].visto_em).not.toBeNull();
    expect(oc[1].visto_em).toBeNull();
  });

  it('outro usuário cria outra ocorrência', async () => {
    await post(U.gerenteA, corpo({ linha_digitavel: L1 })).expect(409);
    await post(U.admin, corpo({ linha_digitavel: L1 })).expect(409);
    const oc = await ocorrencias();
    expect(oc.map((o) => o.usuario_id).sort()).toEqual([1, 2]);
  });

  it('outro restaurante (mesmo usuário) cria outra ocorrência', async () => {
    await post(U.admin, corpo({ restaurante_id: 1, linha_digitavel: L1 })).expect(409);
    await post(U.admin, corpo({ restaurante_id: 2, linha_digitavel: L1 })).expect(409);
    const oc = await ocorrencias();
    expect(oc.map((o) => o.restaurante_id).sort()).toEqual([1, 2]);
  });

  it('outra linha cria outra ocorrência', async () => {
    await post(U.gerenteA, corpo({ linha_digitavel: L1 })).expect(409);
    await post(U.gerenteA, corpo({ linha_digitavel: L2 })).expect(409);
    const oc = await ocorrencias();
    expect(oc.map((o) => o.linha_digitavel).sort()).toEqual([L1, L2].sort());
  });

  it('PUT: tentativas repetidas deduplicam e a ocorrência grava restaurante_id do boleto', async () => {
    await request(env.app).put('/api/boletos/10').set(auth(U.gerenteA)).send({ linha_digitavel: L1 }).expect(409);
    await request(env.app).put('/api/boletos/10').set(auth(U.gerenteA)).send({ linha_digitavel: L1 }).expect(409);
    const oc = await ocorrencias();
    expect(oc).toHaveLength(1);
    expect(oc[0]).toMatchObject({ usuario_id: 2, restaurante_id: 1, linha_digitavel: L1 });
  });

  it('PUT na corrida 23505 (pré-checagem não acha) grava restaurante_id da ocorrência', async () => {
    const original = env.pool.query.bind(env.pool);
    let enganou = false;
    jest.spyOn(env.pool, 'query').mockImplementation((sql, params) => {
      if (!enganou && typeof sql === 'string' && sql.includes('WHERE linha_digitavel = $1')) {
        enganou = true;
        return Promise.resolve({ rows: [], rowCount: 0 });
      }
      return original(sql, params);
    });
    await request(env.app).put('/api/boletos/10').set(auth(U.gerenteA)).send({ linha_digitavel: L2 }).expect(409);
    expect(enganou).toBe(true);
    const oc = await ocorrencias();
    expect(oc).toHaveLength(1);
    expect(oc[0].restaurante_id).toBe(1);
    expect(oc[0].usuario_id).toBe(2);
  });
});
