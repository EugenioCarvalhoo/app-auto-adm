/** Acesso ao banco E2E: garante o Postgres, prepara o schema e semeia o cenário de cada teste. */
const path = require('path');
const { spawnSync } = require('child_process');

const backend = path.join(__dirname, '..', '..', 'backend');
const { Pool } = require(path.join(backend, 'node_modules', 'pg'));
const { semear, cenarioPadrao } = require(path.join(backend, 'test', 'helpers', 'setup.js'));
const { db } = require('./env');

const CONTAINER = process.env.TEST_DB_CONTAINER || 'pg-controle';
const DISTRO = process.env.WSL_DISTRO || 'Ubuntu';
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

async function conecta(database) {
  const pool = new Pool({ ...db, database, connectionTimeoutMillis: 3000 });
  pool.on('error', () => {});
  try {
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  } finally {
    await pool.end().catch(() => {});
  }
}

/** Se o Postgres de teste não responde, tenta iniciar o container existente (o mesmo do `npm test` do backend). */
async function garantirPostgres() {
  if (await conecta('postgres')) return;
  const args = ['start', CONTAINER];
  const r =
    process.platform === 'win32'
      ? spawnSync('wsl', ['-d', DISTRO, '--', 'docker', ...args], { encoding: 'utf8' })
      : spawnSync('docker', args, { encoding: 'utf8' });
  for (let i = 0; i < 30; i += 1) {
    if (await conecta('postgres')) return;
    await dormir(1000);
  }
  throw new Error(
    `Postgres de teste indisponível em ${db.host}:${db.port}. Rode "cd backend && npm test" uma vez para criá-lo ` +
      `(ou defina TEST_DB_*).\n${r.stderr || ''}`
  );
}

async function prepararBanco() {
  await garantirPostgres();
  const admin = new Pool({ ...db, database: 'postgres' });
  try {
    const { rowCount } = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [db.database]);
    if (rowCount === 0) await admin.query(`CREATE DATABASE "${db.database}"`);
  } finally {
    await admin.end();
  }
  const pool = new Pool(db);
  try {
    await pool.query('DROP SCHEMA IF EXISTS public CASCADE');
    await pool.query('CREATE SCHEMA public');
  } finally {
    await pool.end();
  }
  const migrate = spawnSync(process.execPath, [path.join(backend, 'database', 'migrate.js')], {
    env: {
      ...process.env,
      DB_HOST: db.host,
      DB_PORT: String(db.port),
      DB_NAME: db.database,
      DB_USER: db.user,
      DB_PASSWORD: db.password
    },
    encoding: 'utf8'
  });
  if (migrate.status !== 0) throw new Error(`Falha nas migrations E2E:\n${migrate.stdout}\n${migrate.stderr}`);
}

let pool;
const getPool = () => (pool ||= new Pool(db));

const pad = (n) => String(n).padStart(2, '0');
/** Data local (AAAA-MM-DD) deslocada `dias` de hoje. */
function dataIso(dias = 0) {
  const d = new Date();
  d.setDate(d.getDate() + dias);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Cenário E2E: o padrão do backend (admin, gerenteA, gerenteB, semModulo, semVinculo, financeiroLegado;
 * restaurantes A=1, B=2, inativo=3) mais `multi` (boletos, vinculado a A e B), sem metas e com um boleto
 * por restaurante com datas relativas a hoje (o dashboard é semanal).
 */
async function semearCenario() {
  const c = cenarioPadrao();
  c.usuarios.push({ ...c.usuarios[1], id: 7, username: 'multi', nome: 'Usuário Multi' });
  c.vinculos.push({ usuario_id: 7, restaurante_id: 1 }, { usuario_id: 7, restaurante_id: 2 });
  c.metas = [];
  c.boletos = [
    { id: 10, restaurante_id: 1, usuario_id: 2, dt_recebimento: dataIso(0), dt_vencimento: dataIso(3), descricao: 'Fornecedor A', valor: '100.50', tipo: 'Boleto' },
    { id: 20, restaurante_id: 2, usuario_id: 3, dt_recebimento: dataIso(0), dt_vencimento: dataIso(3), descricao: 'Fornecedor B', valor: '200.00', tipo: 'Boleto' }
  ];
  await semear(getPool(), c);
}

const rows = async (sql, params = []) => (await getPool().query(sql, params)).rows;
const fechar = async () => {
  if (pool) await pool.end();
  pool = null;
};

module.exports = { prepararBanco, semearCenario, getPool, rows, fechar, dataIso };
