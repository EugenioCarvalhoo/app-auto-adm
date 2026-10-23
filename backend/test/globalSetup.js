/**
 * Roda uma vez antes de toda a suíte: recria o schema do banco de teste e aplica as migrations
 * com o próprio `database/migrate.js` (assim o migrate também é exercitado a cada execução).
 */
const path = require('path');
const { spawnSync } = require('child_process');
const { Pool } = require('pg');
const { dbConfig } = require('./helpers/dbConfig');
const { configMinio, minioAcessivel, garantirBucket } = require('./helpers/minio');

module.exports = async () => {
  const cfg = dbConfig();
  const pool = new Pool({ ...cfg, connectionTimeoutMillis: 8000 });
  try {
    await pool.query('DROP SCHEMA IF EXISTS public CASCADE');
    await pool.query('CREATE SCHEMA public');
  } catch (err) {
    throw new Error(
      `Não foi possível preparar o banco de teste em ${cfg.host}:${cfg.port}/${cfg.database}: ${err.message}\n` +
        'Suba o Postgres de teste (container pg-controle) ou defina TEST_DB_*. Veja backend/test/README.md.'
    );
  } finally {
    await pool.end();
  }

  const migrate = spawnSync(process.execPath, [path.join(__dirname, '..', 'database', 'migrate.js')], {
    env: {
      ...process.env,
      DB_HOST: cfg.host,
      DB_PORT: String(cfg.port),
      DB_NAME: cfg.database,
      DB_USER: cfg.user,
      DB_PASSWORD: cfg.password
    },
    encoding: 'utf8'
  });
  if (migrate.status !== 0) {
    throw new Error(`Falha ao aplicar migrations no banco de teste:\n${migrate.stdout}\n${migrate.stderr}`);
  }

  // MinIO de teste: opcional. Se estiver no ar, garante o bucket; se não, os testes que o usam PULAM (com aviso).
  process.env.TEST_MINIO_OK = '0';
  const minio = configMinio();
  if (await minioAcessivel(minio)) {
    try {
      await garantirBucket(minio);
      process.env.TEST_MINIO_OK = '1';
    } catch (err) {
      console.warn(`[minio] bucket de teste indisponível (${err.message}); testes de MinIO serão PULADOS.`);
    }
  } else {
    console.warn(`[minio] MinIO de teste fora do ar em ${minio.endpoint}; testes de MinIO serão PULADOS (veja backend/test/README.md).`);
  }
};
