/**
 * Upgrade de um banco EXISTENTE (estado da migration 015, com dados) até a 019, e detecção de
 * migrations pendentes. Roda em um banco ISOLADO (`<banco de teste>` + sufixo `_upgrade_test`), criado
 * e apagado aqui, para não interferir no banco compartilhado dos demais testes.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { Pool } = require('pg');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { dbConfig } = require('./helpers/dbConfig');
const { criarApp } = require('./helpers/app');
const { MIGRATIONS } = require('../database/lista-migrations');

const DIR_MIGRATIONS = path.join(__dirname, '..', 'database', 'migrations');
const MIGRATE_JS = path.join(__dirname, '..', 'database', 'migrate.js');
const ULTIMA_ANTES_DA_016 = '015_vinculo_restaurantes_regra_admin.sql';
const PENDENTES_ESPERADAS = [
  '016_renomeia_vinculo_usuario_restaurantes.sql',
  '017_remove_legado_gastos_estoque.sql',
  '018_boletos_extracoes_uso.sql',
  '019_boletos_extracoes_uso_timestamps.sql'
];

const base = dbConfig();
const NOME_DB = 'controle_financeiro_upgrade_test';
if (!/_test$/.test(NOME_DB)) throw new Error('banco isolado precisa terminar em _test');
const cfgIsolado = { ...base, database: NOME_DB };

/** Usa migracoesPendentes do backend (lib/migracoes) se existir; senão calcula a diferença. */
async function pendentes(pool) {
  let lib = null;
  try {
    // eslint-disable-next-line global-require
    lib = require('../src/health/infrastructure/pg-saude');
  } catch (e) {
    lib = null;
  }
  if (lib && typeof lib.migracoesPendentes === 'function') {
    return lib.migracoesPendentes(pool);
  }
  const existe = (await pool.query(`SELECT to_regclass('public.schema_migrations') AS t`)).rows[0].t;
  const aplicadas = existe ? (await pool.query('SELECT filename FROM schema_migrations')).rows.map((r) => r.filename) : [];
  return MIGRATIONS.filter((m) => !aplicadas.includes(m));
}

function rodarMigrate() {
  return spawnSync(process.execPath, [MIGRATE_JS], {
    env: {
      ...process.env,
      DB_HOST: cfgIsolado.host,
      DB_PORT: String(cfgIsolado.port),
      DB_NAME: cfgIsolado.database,
      DB_USER: cfgIsolado.user,
      DB_PASSWORD: cfgIsolado.password
    },
    encoding: 'utf8'
  });
}

async function recriarBancoIsolado() {
  const admin = new Pool({ ...base, connectionTimeoutMillis: 8000 });
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${NOME_DB} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${NOME_DB}`);
  } finally {
    await admin.end();
  }
}

/** Aplica os .sql até a 015 e registra em schema_migrations, como o migrate.js faria. */
async function montarEstado015(pool) {
  await pool.query('CREATE TABLE IF NOT EXISTS schema_migrations (filename TEXT PRIMARY KEY, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)');
  const ate = MIGRATIONS.indexOf(ULTIMA_ANTES_DA_016);
  for (const f of MIGRATIONS.slice(0, ate + 1)) {
    await pool.query(fs.readFileSync(path.join(DIR_MIGRATIONS, f), 'utf8'));
    await pool.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [f]);
  }
}

/** Dados no estilo antigo (colunas legadas e vínculo em usuario_restaurante_estoque). */
async function semearEstilo015(pool) {
  // as migrations antigas semeiam restaurantes/usuários padrão; parte-se de um cenário conhecido
  await pool.query('TRUNCATE usuarios, restaurantes RESTART IDENTITY CASCADE');
  await pool.query(
    `INSERT INTO restaurantes (id, nome, ativo) VALUES (1, 'Rest A', true), (2, 'Rest B', true), (3, 'Rest Inativo', false)`
  );
  const u = (id, nome, admin, boletos, financeiro, estoque) =>
    pool.query(
      `INSERT INTO usuarios (id, username, password, nome, is_admin, modulo_boletos, modulo_financeiro, modulo_estoque)
       VALUES ($1, $2, 'hash', $2, $3, $4, $5, $6)`,
      [id, nome, admin, boletos, financeiro, estoque]
    );
  await u(1, 'admin', true, true, false, false);
  await u(2, 'comumBoletos', false, true, false, false);
  await u(3, 'comumFinanceiro', false, false, true, false);
  await u(4, 'comumEstoque', false, false, false, true);
  await pool.query(
    `INSERT INTO usuario_restaurante_estoque (usuario_id, restaurante_id) VALUES (2, 1), (2, 2), (3, 1), (4, 2)`
  );
  await pool.query(
    `INSERT INTO boletos_notas (id, restaurante_id, usuario_id, dt_recebimento, dt_vencimento, descricao, valor, tipo)
     VALUES (10, 1, 2, '2026-10-19', '2026-10-30', 'Fornecedor A', 100.50, 'Boleto'),
            (11, 1, 3, '2026-10-20', '2026-11-02', 'Fornecedor A2', 33.33, 'Sem Boleto'),
            (20, 2, 2, '2026-10-19', '2026-10-30', 'Fornecedor B', 200.00, 'Boleto')`
  );
  await pool.query(
    `INSERT INTO boletos_metas_gasto (id, restaurante_id, data_referencia, semana_chave, semana_inicio, semana_fim, maximo_gasto)
     VALUES (1, 1, '2026-10-19', '20261017.20261023', '2026-10-17', '2026-10-23', 1000.00),
            (2, 2, '2026-10-19', '20261017.20261023', '2026-10-17', '2026-10-23', 2000.00)`
  );
}

const tabelasDe = async (pool) =>
  (await pool.query(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`)).rows.map((r) => r.table_name);
const colunasDe = async (pool, tabela) =>
  (await pool.query('SELECT column_name FROM information_schema.columns WHERE table_name = $1', [tabela])).rows.map((r) => r.column_name);

describe('upgrade de banco existente (015 -> 019)', () => {
  let pool;
  const envOriginal = {};
  const CHAVES_ENV = ['NODE_ENV', 'JWT_SECRET', 'DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASSWORD'];

  beforeAll(async () => {
    await recriarBancoIsolado();
    pool = new Pool(cfgIsolado);
    await montarEstado015(pool);
    await semearEstilo015(pool);
  });

  afterAll(async () => {
    if (pool) await pool.end();
    const admin = new Pool(base);
    try {
      await admin.query(`DROP DATABASE IF EXISTS ${NOME_DB} WITH (FORCE)`);
    } finally {
      await admin.end();
    }
  });

  // A ordem é intencional: os testes descrevem a linha do tempo de um mesmo banco (estado 015 -> migrado).
  describe('estado 015 (antes de migrar)', () => {
    it('pré-condição: a tabela ainda é usuario_restaurante_estoque e as colunas legadas existem', async () => {
      const tabelas = await tabelasDe(pool);
      expect(tabelas).toContain('usuario_restaurante_estoque');
      expect(tabelas).not.toContain('usuario_restaurantes');
      expect(await colunasDe(pool, 'usuarios')).toEqual(expect.arrayContaining(['modulo_financeiro', 'modulo_estoque']));
    });

    it('migracoesPendentes lista exatamente a 016, a 017, a 018 e a 019', async () => {
      expect(await pendentes(pool)).toEqual(PENDENTES_ESPERADAS);
    });

    it('sem a tabela schema_migrations, todas as migrations ficam pendentes', async () => {
      const vazio = `${NOME_DB}_vazio_test`;
      const admin = new Pool(base);
      let poolVazio;
      try {
        await admin.query(`DROP DATABASE IF EXISTS ${vazio} WITH (FORCE)`);
        await admin.query(`CREATE DATABASE ${vazio}`);
        poolVazio = new Pool({ ...base, database: vazio });
        expect(await pendentes(poolVazio)).toEqual(MIGRATIONS);
      } finally {
        if (poolVazio) await poolVazio.end();
        await admin.query(`DROP DATABASE IF EXISTS ${vazio} WITH (FORCE)`);
        await admin.end();
      }
    });

    it('a API contra o banco desatualizado responde 503 claro (e não 500 genérico) ao tocar o vínculo', async () => {
      CHAVES_ENV.forEach((k) => {
        envOriginal[k] = process.env[k];
      });
      Object.assign(process.env, {
        NODE_ENV: 'test',
        JWT_SECRET: 'jest_jwt_secret',
        DB_HOST: cfgIsolado.host,
        DB_PORT: String(cfgIsolado.port),
        DB_NAME: cfgIsolado.database,
        DB_USER: cfgIsolado.user,
        DB_PASSWORD: cfgIsolado.password
      });
      let appPool;
      jest.spyOn(console, 'error').mockImplementation(() => {});
      try {
        await jest.isolateModulesAsync(async () => {
          const { app, pool: poolDoApp } = await criarApp();
          appPool = poolDoApp;
          const token = jwt.sign({ id: 1, username: 'admin', is_admin: true }, 'jest_jwt_secret', { expiresIn: '1h' });
          const res = await request(app).get('/api/admin/usuarios-permissoes').set('Authorization', `Bearer ${token}`);
          expect(res.status).toBe(503);
          expect(JSON.stringify(res.body)).toMatch(/Banco desatualizado: migrations pendentes/);
        });
      } finally {
        jest.restoreAllMocks();
        if (appPool) await appPool.end();
        CHAVES_ENV.forEach((k) => {
          if (envOriginal[k] === undefined) delete process.env[k];
          else process.env[k] = envOriginal[k];
        });
      }
    });
  });

  describe('depois de rodar o migrate.js completo', () => {
    let saida1;
    beforeAll(() => {
      saida1 = rodarMigrate();
    });

    it('o migrate termina com sucesso e aplica só a 016, a 017, a 018 e a 019', () => {
      expect(saida1.status).toBe(0);
      expect(saida1.stdout).toContain(`Executando migração: ${PENDENTES_ESPERADAS[0]}`);
      expect(saida1.stdout).toContain(`Executando migração: ${PENDENTES_ESPERADAS[1]}`);
      expect(saida1.stdout).toContain(`Executando migração: ${PENDENTES_ESPERADAS[2]}`);
      expect(saida1.stdout).not.toContain('Executando migração: 014');
      expect(saida1.stdout).not.toContain('Executando migração: 015');
    });

    it('016 a 019 ficaram registradas em schema_migrations e não há pendências', async () => {
      const reg = (await pool.query('SELECT filename FROM schema_migrations')).rows.map((r) => r.filename);
      expect(reg).toEqual(expect.arrayContaining(PENDENTES_ESPERADAS));
      expect(reg).toHaveLength(MIGRATIONS.length);
      expect(await pendentes(pool)).toEqual([]);
    });

    it('018: a tabela do limite diário de leituras por IA existe, com chave (usuário, dia) e total não negativo', async () => {
      expect(await tabelasDe(pool)).toContain('boletos_extracoes_uso');
      const pk = (await pool.query(
        `SELECT a.attname AS coluna FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
         WHERE i.indrelid = 'boletos_extracoes_uso'::regclass AND i.indisprimary ORDER BY a.attnum`
      )).rows.map((r) => r.coluna);
      expect(pk).toEqual(['usuario_id', 'dia']);
      await expect(
        pool.query(`INSERT INTO boletos_extracoes_uso (usuario_id, dia, total) VALUES (1, '2026-10-23', -1)`)
      ).rejects.toMatchObject({ code: '23514' });
    });

    it('usuario_restaurantes existe com TODOS os vínculos e índices; a tabela antiga sumiu', async () => {
      const tabelas = await tabelasDe(pool);
      expect(tabelas).toContain('usuario_restaurantes');
      expect(tabelas).not.toContain('usuario_restaurante_estoque');
      const v = (await pool.query('SELECT usuario_id, restaurante_id FROM usuario_restaurantes ORDER BY 1, 2')).rows.map(
        (r) => `${r.usuario_id}:${r.restaurante_id}`
      );
      expect(v).toEqual(['2:1', '2:2', '3:1', '4:2']);
      const idx = (await pool.query(`SELECT indexname FROM pg_indexes WHERE tablename = 'usuario_restaurantes'`)).rows.map((r) => r.indexname);
      expect(idx).toEqual(
        expect.arrayContaining([
          'usuario_restaurantes_pkey',
          'idx_usuario_restaurantes_usuario',
          'idx_usuario_restaurantes_restaurante'
        ])
      );
    });

    it('boletos, metas, usuários e restaurantes ficaram intactos', async () => {
      const q = async (sql) => (await pool.query(sql)).rows;
      expect(await q('SELECT id, nome, ativo FROM restaurantes ORDER BY id')).toEqual([
        { id: 1, nome: 'Rest A', ativo: true },
        { id: 2, nome: 'Rest B', ativo: true },
        { id: 3, nome: 'Rest Inativo', ativo: false }
      ]);
      expect(await q('SELECT id, username, is_admin, modulo_boletos FROM usuarios ORDER BY id')).toEqual([
        { id: 1, username: 'admin', is_admin: true, modulo_boletos: true },
        { id: 2, username: 'comumBoletos', is_admin: false, modulo_boletos: true },
        { id: 3, username: 'comumFinanceiro', is_admin: false, modulo_boletos: false },
        { id: 4, username: 'comumEstoque', is_admin: false, modulo_boletos: false }
      ]);
      const boletos = await q('SELECT id, restaurante_id, usuario_id, descricao, valor::text AS valor, tipo FROM boletos_notas ORDER BY id');
      expect(boletos).toEqual([
        { id: 10, restaurante_id: 1, usuario_id: 2, descricao: 'Fornecedor A', valor: '100.50', tipo: 'Boleto' },
        { id: 11, restaurante_id: 1, usuario_id: 3, descricao: 'Fornecedor A2', valor: '33.33', tipo: 'Sem Boleto' },
        { id: 20, restaurante_id: 2, usuario_id: 2, descricao: 'Fornecedor B', valor: '200.00', tipo: 'Boleto' }
      ]);
      expect(await q('SELECT id, restaurante_id, maximo_gasto::text AS m FROM boletos_metas_gasto ORDER BY id')).toEqual([
        { id: 1, restaurante_id: 1, m: '1000.00' },
        { id: 2, restaurante_id: 2, m: '2000.00' }
      ]);
    });

    it('colunas legadas de usuarios foram removidas e modulo_boletos foi preservado', async () => {
      const cols = await colunasDe(pool, 'usuarios');
      for (const legada of ['modulo_financeiro', 'modulo_estoque', 'modulo_estoque_simplificado', 'somente_estoque']) {
        expect(cols).not.toContain(legada);
      }
      expect(cols).toEqual(expect.arrayContaining(['is_admin', 'modulo_boletos']));
      const tabelas = await tabelasDe(pool);
      expect(tabelas.filter((t) => t === 'gastos' || t.startsWith('estoque_'))).toEqual([]);
    });

    it('uma segunda execução do migrate não muda nada', async () => {
      const antes = (await pool.query('SELECT filename, applied_at FROM schema_migrations ORDER BY filename')).rows;
      const vAntes = (await pool.query('SELECT * FROM usuario_restaurantes ORDER BY 1, 2')).rows;
      const r = rodarMigrate();
      expect(r.status).toBe(0);
      expect(r.stdout).not.toContain('Executando migração');
      expect((await pool.query('SELECT filename, applied_at FROM schema_migrations ORDER BY filename')).rows).toEqual(antes);
      expect((await pool.query('SELECT * FROM usuario_restaurantes ORDER BY 1, 2')).rows).toEqual(vAntes);
    });
  });
});
