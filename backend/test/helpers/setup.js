/**
 * Ambiente dos testes de API: app Express real + Postgres real (banco `*_test`).
 *
 * Uso em um arquivo de teste:
 *   const env = usarBancoReal();            // registra beforeAll/beforeEach/afterAll
 *   await request(env.app).get(...);        // app real
 *   await env.rows('SELECT ...', [params]); // inspeciona o banco depois
 */
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { dbConfig } = require('./dbConfig');

const JWT_SECRET = 'jest_jwt_secret';

/** Cenário padrão: restaurantes A (1) e B (2), mais um inativo (3), e um usuário de cada perfil. */
function cenarioPadrao() {
  const hash = bcrypt.hashSync('senha123', 4);
  const base = { password: hash, nome: 'Fulano' };
  const usuarios = [
    { ...base, id: 1, username: 'admin', is_admin: true },
    { ...base, id: 2, username: 'gerenteA', is_admin: false, modulo_boletos: true },
    { ...base, id: 3, username: 'gerenteB', is_admin: false, modulo_boletos: true },
    { ...base, id: 4, username: 'semModulo', is_admin: false, modulo_boletos: false },
    { ...base, id: 5, username: 'semVinculo', is_admin: false, modulo_boletos: true },
    // legado: tinha acesso livre pelo antigo modulo_financeiro (já removido); só vê o restaurante vinculado
    { ...base, id: 6, username: 'financeiroLegado', is_admin: false, modulo_boletos: true }
  ];
  const restaurantes = [
    { id: 1, nome: 'Restaurante A', ativo: true },
    { id: 2, nome: 'Restaurante B', ativo: true },
    { id: 3, nome: 'Restaurante Inativo', ativo: false }
  ];
  const vinculos = [
    { usuario_id: 2, restaurante_id: 1 },
    { usuario_id: 3, restaurante_id: 2 },
    { usuario_id: 4, restaurante_id: 1 },
    { usuario_id: 6, restaurante_id: 1 }
  ];
  const boletos = [
    { id: 10, restaurante_id: 1, usuario_id: 2, dt_recebimento: '2026-10-19', dt_vencimento: '2026-10-30', descricao: 'Fornecedor A', valor: '100.50', tipo: 'Boleto' },
    { id: 20, restaurante_id: 2, usuario_id: 3, dt_recebimento: '2026-10-19', dt_vencimento: '2026-10-30', descricao: 'Fornecedor B', valor: '200.00', tipo: 'Boleto' }
  ];
  const metas = [
    { id: 1, restaurante_id: 1, data_referencia: '2026-10-19', semana_chave: '20261017.20261023', semana_inicio: '2026-10-17', semana_fim: '2026-10-23', maximo_gasto: '1000.00' },
    { id: 2, restaurante_id: 2, data_referencia: '2026-10-19', semana_chave: '20261017.20261023', semana_inicio: '2026-10-17', semana_fim: '2026-10-23', maximo_gasto: '2000.00' }
  ];
  return { usuarios, restaurantes, vinculos, boletos, metas };
}

/** Limpa as tabelas e grava o cenário. Os ids dos dados novos criados pelos testes começam em 100. */
async function semear(pool, c = cenarioPadrao()) {
  await pool.query('TRUNCATE usuarios, restaurantes RESTART IDENTITY CASCADE');
  for (const u of c.usuarios) {
    await pool.query(
      `INSERT INTO usuarios (id, username, password, nome, is_admin, modulo_boletos)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [u.id, u.username, u.password, u.nome, !!u.is_admin, !!u.modulo_boletos]
    );
  }
  for (const r of c.restaurantes) {
    await pool.query('INSERT INTO restaurantes (id, nome, ativo) VALUES ($1, $2, $3)', [r.id, r.nome, r.ativo]);
  }
  for (const v of c.vinculos) {
    await pool.query('INSERT INTO usuario_restaurantes (usuario_id, restaurante_id) VALUES ($1, $2)', [
      v.usuario_id,
      v.restaurante_id
    ]);
  }
  for (const b of c.boletos) {
    await pool.query(
      `INSERT INTO boletos_notas (id, restaurante_id, usuario_id, dt_recebimento, dt_vencimento, descricao, valor, tipo)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [b.id, b.restaurante_id, b.usuario_id, b.dt_recebimento, b.dt_vencimento, b.descricao, b.valor, b.tipo]
    );
  }
  for (const m of c.metas) {
    await pool.query(
      `INSERT INTO boletos_metas_gasto (id, restaurante_id, data_referencia, semana_chave, semana_inicio, semana_fim, maximo_gasto)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [m.id, m.restaurante_id, m.data_referencia, m.semana_chave, m.semana_inicio, m.semana_fim, m.maximo_gasto]
    );
  }
  for (const tabela of ['usuarios', 'restaurantes', 'boletos_notas', 'boletos_metas_gasto']) {
    await pool.query(`SELECT setval(pg_get_serial_sequence('${tabela}', 'id'), 100)`);
  }
}

/**
 * Registra os hooks do Jest e devolve o ambiente. O app é carregado uma vez por arquivo de teste
 * (cada arquivo tem seu próprio registro de módulos e seu próprio pool); o banco é semeado a cada teste.
 */
function usarBancoReal() {
  const env = { app: null, pool: null };

  beforeAll(() => {
    const cfg = dbConfig();
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = JWT_SECRET;
    process.env.DB_HOST = cfg.host;
    process.env.DB_PORT = String(cfg.port);
    process.env.DB_NAME = cfg.database;
    process.env.DB_USER = cfg.user;
    process.env.DB_PASSWORD = cfg.password;
    // eslint-disable-next-line global-require
    env.app = require('../../server');
    env.pool = env.app.locals.pool;
  });

  beforeEach(() => semear(env.pool));

  afterAll(() => env.pool.end());

  /** Linhas de uma consulta direta ao banco (para conferir o efeito de uma requisição). */
  env.rows = async (sql, params = []) => (await env.pool.query(sql, params)).rows;
  /** Primeira linha (ou undefined). */
  env.um = async (sql, params = []) => (await env.rows(sql, params))[0];
  return env;
}

/** Token com os mesmos campos básicos do login. As flags de permissão são sempre relidas do banco. */
function tokenDe(usuario, opcoes = {}) {
  return jwt.sign(
    { id: usuario.id, username: usuario.username, is_admin: !!usuario.is_admin },
    JWT_SECRET,
    { expiresIn: '1h', ...opcoes }
  );
}
const auth = (u) => ({ Authorization: `Bearer ${tokenDe(u)}` });

const U = Object.fromEntries(cenarioPadrao().usuarios.map((u) => [u.username, u]));

module.exports = { usarBancoReal, semear, auth, tokenDe, cenarioPadrao, U, JWT_SECRET };
