#!/usr/bin/env node
/**
 * `npm test`: garante o Postgres de teste e roda o Jest.
 *
 *  1. Tenta conectar no banco de teste (padrão 127.0.0.1:5433).
 *  2. Se não conectar e o host for local, sobe o container Docker (cria, ou inicia se já existe).
 *     No Windows usa o Docker de dentro do WSL (`wsl -d <distro> -- docker ...`).
 *  3. Cria o banco `*_test` se ainda não existir.
 *  4. Roda o Jest repassando os argumentos (ex.: `npm test -- test/boletos.test.js`).
 *
 * Variáveis opcionais:
 *   TEST_DB_HOST/PORT/NAME/USER/PASSWORD  conexão (padrão: 127.0.0.1:5433/controle_financeiro_test, postgres/postgres)
 *   TEST_DB_CONTAINER   nome do container   (padrão: pg-controle)
 *   TEST_DB_IMAGE       imagem              (padrão: postgres:15)
 *   TEST_DB_VOLUME      volume de dados     (padrão: pg_controle_data)
 *   WSL_DISTRO          distro WSL2 com Docker (padrão: Ubuntu)
 *   TEST_DB_AUTOSTART=0 não mexe no Docker; só testa a conexão
 */
const path = require('path');
const { spawnSync } = require('child_process');
const { Pool } = require('pg');
const { dbConfig } = require('../test/helpers/dbConfig');

const BACKEND_DIR = path.join(__dirname, '..');
const CONTAINER = process.env.TEST_DB_CONTAINER || 'pg-controle';
const IMAGE = process.env.TEST_DB_IMAGE || 'postgres:15';
const VOLUME = process.env.TEST_DB_VOLUME || 'pg_controle_data';
const DISTRO = process.env.WSL_DISTRO || 'Ubuntu';
const IS_WINDOWS = process.platform === 'win32';

const log = (msg) => console.log(`[test-db] ${msg}`);
const dormir = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function falhar(msg) {
  console.error(`\n[test-db] ERRO: ${msg}\n`);
  process.exit(1);
}

/** Executa `docker <args>` (no Windows, dentro da distro WSL). Sem shell, então sem problemas de aspas. */
function docker(args) {
  const [cmd, cmdArgs] = IS_WINDOWS
    ? ['wsl', ['-d', DISTRO, '--', 'docker', ...args]]
    : ['docker', args];
  const r = spawnSync(cmd, cmdArgs, { encoding: 'utf8' });
  if (r.error) {
    const onde = IS_WINDOWS ? `o comando "wsl" (distro ${DISTRO})` : 'o comando "docker"';
    falhar(`não consegui executar ${onde}: ${r.error.message}`);
  }
  return r;
}

/** Tenta abrir uma conexão. Devolve true/false, nunca lança. */
async function conecta(cfg, database) {
  const pool = new Pool({ ...cfg, database, connectionTimeoutMillis: 3000 });
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

function subirContainer(cfg) {
  const info = docker(['version', '--format', '{{.Server.Version}}']);
  if (info.status !== 0) {
    falhar(
      'o Docker não está respondendo' +
        (IS_WINDOWS ? ` na distro WSL "${DISTRO}" (use uma distro WSL2; defina WSL_DISTRO se for outra)` : '') +
        `.\n${(info.stderr || info.stdout || '').trim()}`
    );
  }

  const estado = docker(['ps', '-a', '--filter', `name=^/${CONTAINER}$`, '--format', '{{.State}}']).stdout.trim();
  if (estado === 'running') {
    log(`container ${CONTAINER} já está rodando; aguardando aceitar conexões...`);
    return;
  }
  if (estado) {
    log(`iniciando o container ${CONTAINER} (estava "${estado}")...`);
    const r = docker(['start', CONTAINER]);
    if (r.status !== 0) falhar(`docker start falhou:\n${r.stderr.trim()}`);
    return;
  }

  log(`container ${CONTAINER} não existe; criando a partir de ${IMAGE} (a primeira vez baixa a imagem)...`);
  const r = docker([
    'run', '-d', '--name', CONTAINER,
    '-p', `127.0.0.1:${cfg.port}:5432`,
    '-e', `POSTGRES_USER=${cfg.user}`,
    '-e', `POSTGRES_PASSWORD=${cfg.password}`,
    '-e', 'POSTGRES_DB=controle_financeiro_dev',
    '-v', `${VOLUME}:/var/lib/postgresql/data`,
    IMAGE
  ]);
  if (r.status !== 0) {
    falhar(
      `docker run falhou:\n${r.stderr.trim()}\n` +
        `Se a porta ${cfg.port} estiver em uso, defina TEST_DB_PORT para outra porta livre.`
    );
  }
}

async function esperarBanco(cfg, tentativas = 40) {
  for (let i = 0; i < tentativas; i += 1) {
    if (await conecta(cfg, 'postgres')) return;
    await dormir(1000);
  }
  falhar(`o Postgres não aceitou conexões em ${cfg.host}:${cfg.port} após ${tentativas}s.`);
}

async function garantirBancoDeTeste(cfg) {
  // Nome já validado por dbConfig() (termina em _test); aqui só garantimos que é um identificador simples.
  if (!/^[a-z0-9_]+$/i.test(cfg.database)) falhar(`nome de banco inválido: ${cfg.database}`);
  const pool = new Pool({ ...cfg, database: 'postgres', connectionTimeoutMillis: 5000 });
  try {
    const { rowCount } = await pool.query('SELECT 1 FROM pg_database WHERE datname = $1', [cfg.database]);
    if (rowCount === 0) {
      log(`criando o banco ${cfg.database}...`);
      await pool.query(`CREATE DATABASE "${cfg.database}"`);
    }
  } finally {
    await pool.end();
  }
}

async function main() {
  let cfg;
  try {
    cfg = dbConfig(); // aborta se o banco não terminar em _test
  } catch (err) {
    falhar(err.message);
  }

  if (!(await conecta(cfg, 'postgres'))) {
    const local = ['127.0.0.1', 'localhost', '::1'].includes(cfg.host);
    if (process.env.TEST_DB_AUTOSTART === '0' || !local) {
      falhar(
        `não consegui conectar em ${cfg.host}:${cfg.port}. ` +
          (local ? 'TEST_DB_AUTOSTART=0 impede subir o Docker.' : 'O host não é local; suba o banco manualmente.')
      );
    }
    subirContainer(cfg);
    await esperarBanco(cfg);
  } else {
    log(`Postgres já disponível em ${cfg.host}:${cfg.port}.`);
  }

  await garantirBancoDeTeste(cfg);
  log(`banco de teste pronto (${cfg.database}). Rodando o Jest...\n`);

  const jest = spawnSync(process.execPath, [require.resolve('jest/bin/jest'), ...process.argv.slice(2)], {
    cwd: BACKEND_DIR,
    stdio: 'inherit',
    env: process.env
  });
  process.exit(jest.status === null ? 1 : jest.status);
}

main().catch((err) => falhar(err.stack || err.message));
