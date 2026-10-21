const { Pool } = require('pg');

// Carregue o .env (dotenv) antes de requerer este módulo.
const pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'controle_financeiro',
  password: process.env.DB_PASSWORD || 'postgres',
  port: parseInt(process.env.DB_PORT, 10) || 5432,
});

// Log de debug e ping inicial (evita ruído e conexão real em testes automatizados)
if (process.env.NODE_ENV !== 'test') {
  console.log('🔍 Configuração do Banco:');
  console.log('  DB_HOST:', process.env.DB_HOST || '(não definido)');
  console.log('  DB_PORT:', process.env.DB_PORT || '(não definido)');
  console.log('  DB_NAME:', process.env.DB_NAME || '(não definido)');
  console.log('  DB_USER:', process.env.DB_USER || '(não definido)');

  pool.query('SELECT NOW()', (err, res) => {
    if (err) {
      console.error('Erro ao conectar ao banco de dados:', err);
    } else {
      console.log('Conectado ao PostgreSQL:', res.rows[0].now);
    }
  });
}

module.exports = pool;
