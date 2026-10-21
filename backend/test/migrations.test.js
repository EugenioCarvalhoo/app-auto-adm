/**
 * Migrations no Postgres real: schema completo (001–017 aplicadas pelo globalSetup via migrate.js),
 * regra de vínculo da 015 e idempotência do migrate.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { Pool } = require('pg');
const { dbConfig } = require('./helpers/dbConfig');
const { semear, cenarioPadrao } = require('./helpers/setup');

// A 015 foi escrita com o nome antigo da tabela (a 016 a renomeou); aqui ela roda contra o nome atual.
const MIGRATION_015 = fs
  .readFileSync(path.join(__dirname, '..', 'database', 'migrations', '015_vinculo_restaurantes_regra_admin.sql'), 'utf8')
  .replace(/usuario_restaurante_estoque/g, 'usuario_restaurantes');

describe('migrations (Postgres real)', () => {
  let pool;
  const cfg = dbConfig();
  const vinculos = async () =>
    (await pool.query('SELECT usuario_id, restaurante_id FROM usuario_restaurantes ORDER BY 1, 2')).rows.map(
      (r) => `${r.usuario_id}:${r.restaurante_id}`
    );

  beforeAll(() => {
    pool = new Pool(cfg);
  });
  afterAll(() => pool.end());

  it('o schema tem as tabelas e colunas que o escopo ativo usa', async () => {
    const { rows } = await pool.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`
    );
    const tabelas = rows.map((r) => r.table_name);
    expect(tabelas).toEqual(
      expect.arrayContaining(['usuarios', 'restaurantes', 'usuario_restaurantes', 'boletos_notas', 'boletos_metas_gasto', 'schema_migrations'])
    );
    const cols = (await pool.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'usuarios'`
    )).rows.map((r) => r.column_name);
    expect(cols).toEqual(expect.arrayContaining(['is_admin', 'modulo_boletos']));
  });

  it('todas as migrations do migrate.js ficaram registradas em schema_migrations', async () => {
    const { rows } = await pool.query('SELECT filename FROM schema_migrations ORDER BY filename');
    expect(rows.map((r) => r.filename)).toContain('015_vinculo_restaurantes_regra_admin.sql');
    // 16 arquivos: existem duas migrations com prefixo 003
    const arquivos = fs.readdirSync(path.join(__dirname, '..', 'database', 'migrations')).filter((f) => f.endsWith('.sql'));
    expect(rows).toHaveLength(arquivos.length);
  });

  it('016: a tabela antiga foi renomeada, com dados e índices', async () => {
    const tabelas = (await pool.query(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`)).rows.map((r) => r.table_name);
    expect(tabelas).toContain('usuario_restaurantes');
    expect(tabelas).not.toContain('usuario_restaurante_estoque');
    const idx = (await pool.query(`SELECT indexname FROM pg_indexes WHERE tablename = 'usuario_restaurantes'`)).rows.map((r) => r.indexname);
    expect(idx).toEqual(expect.arrayContaining(['usuario_restaurantes_pkey', 'idx_usuario_restaurantes_usuario']));
  });

  it('017: gastos, estoque e as flags legadas foram removidos', async () => {
    const tabelas = (await pool.query(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`)).rows.map((r) => r.table_name);
    expect(tabelas.filter((t) => t === 'gastos' || t.startsWith('estoque_'))).toEqual([]);
    const cols = (await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'usuarios'`)).rows.map((r) => r.column_name);
    for (const legada of ['modulo_financeiro', 'modulo_estoque', 'modulo_estoque_simplificado', 'somente_estoque']) {
      expect(cols).not.toContain(legada);
    }
    expect(cols).toEqual(expect.arrayContaining(['is_admin', 'modulo_boletos']));
  });

  describe('015: vínculo de quem tinha acesso livre (modulo_financeiro)', () => {
    // A 017 removeu a coluna; para exercitar a regra da 015 recriamos a coluna só dentro deste bloco.
    beforeAll(() => pool.query('ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS modulo_financeiro BOOLEAN NOT NULL DEFAULT false'));
    afterAll(() => pool.query('ALTER TABLE usuarios DROP COLUMN IF EXISTS modulo_financeiro'));

    beforeEach(async () => {
      await semear(pool, cenarioPadrao());
      await pool.query('UPDATE usuarios SET modulo_financeiro = true WHERE id = 6');
      await pool.query('DELETE FROM usuario_restaurantes');
    });

    it('vincula usuário comum com modulo_financeiro a todos os restaurantes ATIVOS', async () => {
      await pool.query(MIGRATION_015);
      const v = await vinculos();
      expect(v).toContain('6:1');
      expect(v).toContain('6:2');
      expect(v).not.toContain('6:3'); // restaurante inativo
    });

    it('não vincula admin, nem usuário sem modulo_financeiro', async () => {
      await pool.query(MIGRATION_015);
      const v = await vinculos();
      const donos = new Set(v.map((x) => x.split(':')[0]));
      expect([...donos]).toEqual(['6']);
    });

    it('é idempotente: rodar de novo não duplica nem falha', async () => {
      await pool.query(MIGRATION_015);
      const primeira = await vinculos();
      await pool.query(MIGRATION_015);
      expect(await vinculos()).toEqual(primeira);
    });

    it('preserva vínculos já existentes do usuário', async () => {
      await pool.query('INSERT INTO usuario_restaurantes (usuario_id, restaurante_id) VALUES (6, 1)');
      await pool.query(MIGRATION_015);
      expect((await vinculos()).filter((x) => x.startsWith('6:')).sort()).toEqual(['6:1', '6:2']);
    });
  });

  describe('migrate.js', () => {
    it('numa segunda execução, pula tudo e NÃO reaplica a 015 (não recria vínculos removidos pelo admin)', async () => {
      await semear(pool, cenarioPadrao());
      await pool.query('DELETE FROM usuario_restaurantes');

      const r = spawnSync(process.execPath, [path.join(__dirname, '..', 'database', 'migrate.js')], {
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
      expect(r.status).toBe(0);
      expect(r.stdout).toContain('015_vinculo_restaurantes_regra_admin.sql já aplicada, pulando');
      expect(r.stdout).not.toContain('Executando migração');
      expect(await vinculos()).toEqual([]);
    });
  });
});
