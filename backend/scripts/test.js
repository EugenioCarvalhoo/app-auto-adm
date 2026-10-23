#!/usr/bin/env node
/**
 * `npm test`: garante o Postgres de teste e roda o Jest.
 *
 *  1. Tenta conectar no banco de teste (padrão 127.0.0.1:5433).
 *  2. Se não conectar e o host for local, sobe o container Docker (cria, ou inicia se já existe).
 *     No Windows usa o Docker de dentro do WSL (`wsl -d <distro> -- docker ...`).
 *  3. Cria o banco `*_test` se ainda não existir.
 *  4. No Windows, mantém a distro WSL acordada enquanto o Jest roda (sem isso o WSL se desliga ao ficar
 *     ocioso e derruba o container no meio da suíte, causando ECONNREFUSED em massa).
 *  5. Reconfirma a conexão logo antes do Jest e roda o Jest repassando os argumentos
 *     (ex.: `npm test -- test/boletos.test.js`). Ao final, imprime um resumo curto (suítes lentas e com falha).
 *
 * Variáveis opcionais:
 *   TEST_DB_HOST/PORT/NAME/USER/PASSWORD  conexão (padrão: 127.0.0.1:5433/controle_financeiro_test, postgres/postgres)
 *   TEST_DB_CONTAINER   nome do container   (padrão: pg-controle)
 *   TEST_DB_IMAGE       imagem              (padrão: postgres:15)
 *   TEST_DB_VOLUME      volume de dados     (padrão: pg_controle_data)
 *   WSL_DISTRO          distro WSL2 com Docker (padrão: Ubuntu)
 *   TEST_DB_AUTOSTART=0 não mexe no Docker; só testa a conexão
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { manterWslAcordado } = require('./wslKeepalive');
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

/** Resumo curto do relatório JSON do Jest: totais, suítes com falha e as mais lentas. */
function imprimirResumo(arquivo) {
  let r;
  try {
    r = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
  } catch {
    return;
  } finally {
    fs.rmSync(arquivo, { force: true });
  }
  const nome = (suite) => path.relative(BACKEND_DIR, suite.name).split(path.sep).join('/');
  const duracao = (suite) => (suite.endTime - suite.startTime) / 1000;
  const suites = r.testResults || [];
  const falhas = suites.filter((x) => x.status === 'failed');
  console.log('\n[test-resumo] ' + `${r.numPassedTests} ok, ${r.numFailedTests} falhas, ${r.numTotalTests} testes em ${suites.length} suítes`);
  if (falhas.length) {
    console.log('[test-resumo] suítes com falha:');
    for (const x of falhas) {
      const primeira = (x.assertionResults || []).find((a) => a.status === 'failed');
      const msg = (primeira?.failureMessages?.[0] || x.message || '').split('\n').find((l) => l.trim()) || '';
      console.log(`  - ${nome(x)} (${(x.assertionResults || []).filter((a) => a.status === 'failed').length} falhas): ${msg.trim().slice(0, 140)}`);
    }
    if (falhas.length > 1 && (r.numFailedTests > 0) && falhas.every((x) => /ECONNREFUSED|ECONNRESET|terminating connection/.test(JSON.stringify(x.assertionResults) + (x.message || '')))) {
      console.log('[test-resumo] todas as falhas são de conexão: problema de ambiente (Postgres/WSL), não de código.');
    }
  }
  console.log('[test-resumo] mais lentas:');
  for (const x of [...suites].sort((a, b) => duracao(b) - duracao(a)).slice(0, 5)) {
    console.log(`  - ${duracao(x).toFixed(1)}s ${nome(x)}`);
  }
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

  manterWslAcordado(DISTRO);

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
  if (!(await conecta(cfg, cfg.database))) {
    falhar(`o Postgres deixou de responder em ${cfg.host}:${cfg.port} antes de iniciar o Jest. Rode novamente.`);
  }
  log(`banco de teste pronto (${cfg.database}). Rodando o Jest...\n`);

  // Localmente para na 1ª suíte com falha (o restante costuma ser efeito dela). `--no-bail` ou CI roda tudo.
  const args = process.argv.slice(2);
  if (!process.env.CI && !args.some((a) => /^--(no-)?bail/.test(a))) args.push('--bail');
  const relatorio = path.join(os.tmpdir(), `jest-resumo-${process.pid}.json`);
  const jest = spawnSync(
    process.execPath,
    [require.resolve('jest/bin/jest'), ...args, '--json', `--outputFile=${relatorio}`],
    { cwd: BACKEND_DIR, stdio: 'inherit', env: process.env }
  );
  imprimirResumo(relatorio);
  process.exit(jest.status === null ? 1 : jest.status);
}

main().catch((err) => falhar(err.stack || err.message));
