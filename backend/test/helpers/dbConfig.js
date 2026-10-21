/**
 * Conexão do banco de TESTE (Postgres real). Valores padrão apontam para o container local
 * `pg-controle` (127.0.0.1:5433). Para outro ambiente, defina TEST_DB_*.
 *
 * Guarda de segurança: os testes fazem TRUNCATE e recriam o schema, então só rodam em banco
 * cujo nome termine em "_test". Nunca aponte para homologação ou produção.
 */
function dbConfig() {
  const cfg = {
    host: process.env.TEST_DB_HOST || '127.0.0.1',
    port: parseInt(process.env.TEST_DB_PORT, 10) || 5433,
    database: process.env.TEST_DB_NAME || 'controle_financeiro_test',
    user: process.env.TEST_DB_USER || 'postgres',
    password: process.env.TEST_DB_PASSWORD || 'postgres'
  };
  if (!/_test$/.test(cfg.database)) {
    throw new Error(
      `Recusado: o banco de teste deve terminar em "_test" (recebido "${cfg.database}"). ` +
        'Os testes apagam todos os dados do banco.'
    );
  }
  return cfg;
}

module.exports = { dbConfig };
