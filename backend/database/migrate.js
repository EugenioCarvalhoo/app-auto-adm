const { Pool } = require('pg');
const dotenv = require('dotenv');
const fs = require('fs');
const path = require('path');

// Carregar .env do diretório backend
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'controle_financeiro',
  password: process.env.DB_PASSWORD || 'postgres',
  port: process.env.DB_PORT || 5432,
});

async function migrate() {
  try {
    console.log('Iniciando migrações...');
    
    // List of migrations to run
    const migrations = [
      '001_create_gastos_table.sql',
      '002_create_usuarios_table.sql',
      '003_create_restaurantes_table.sql',
      '004_add_restaurante_id_to_gastos.sql',
      '005_create_restaurante_modelo_and_update_gastos.sql',
      '003_add_retroativo_to_gastos.sql',
      '006_estoque_modulo.sql',
      '007_usuario_restaurante_estoque.sql',
      '008_estoque_movimentos.sql',
      '009_estoque_movimentos_operacao_estorno.sql',
      '010_estoque_movimentos_trigger_defaults.sql',
      '011_estoque_produto_critica_foto.sql',
      '012_estoque_lancamentos_diarios.sql',
      '013_usuario_modulos_permissao.sql',
      '014_boletos_notas.sql',
      '015_vinculo_restaurantes_regra_admin.sql',
      '016_renomeia_vinculo_usuario_restaurantes.sql',
      '017_remove_legado_gastos_estoque.sql'
    ];

    // Registro das migrations já aplicadas: evita reexecutar as que não são repetíveis
    // (ex.: a 015 revincularia usuários a restaurantes que o admin já removeu).
    await pool.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename TEXT PRIMARY KEY,
        applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    const aplicadas = new Set(
      (await pool.query('SELECT filename FROM schema_migrations')).rows.map((r) => r.filename)
    );

    for (const migrationFile of migrations) {
      if (aplicadas.has(migrationFile)) {
        console.log(`- ${migrationFile} já aplicada, pulando`);
        continue;
      }
      console.log(`Executando migração: ${migrationFile}`);
      const migrationSQL = fs.readFileSync(
        path.join(__dirname, 'migrations', migrationFile),
        'utf8'
      );
      await pool.query(migrationSQL);
      await pool.query(
        'INSERT INTO schema_migrations (filename) VALUES ($1) ON CONFLICT DO NOTHING',
        [migrationFile]
      );
      console.log(`✓ ${migrationFile} executada com sucesso`);
    }
    
    console.log('Todas as migrações foram executadas com sucesso!');
    
    process.exit(0);
  } catch (error) {
    console.error('Erro na migração:', error);
    process.exit(1);
  }
}

migrate();

