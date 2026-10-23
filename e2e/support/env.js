/**
 * Configuração do ambiente E2E. Banco próprio (`*_e2e_test`), portas próprias, para não
 * colidir com `npm run dev` (5000/3000) nem com os testes Jest (`controle_financeiro_test`).
 * O nome termina em `_test` porque o semeador reaproveitado do backend recusa qualquer outro.
 */
const db = {
  host: process.env.TEST_DB_HOST || '127.0.0.1',
  port: parseInt(process.env.TEST_DB_PORT, 10) || 5433,
  database: process.env.E2E_DB_NAME || 'controle_financeiro_e2e_test',
  user: process.env.TEST_DB_USER || 'postgres',
  password: process.env.TEST_DB_PASSWORD || 'postgres'
};

if (!/_test$/.test(db.database)) {
  throw new Error(`Recusado: o banco E2E deve terminar em "_test" (recebido "${db.database}").`);
}

const API_PORT = parseInt(process.env.E2E_API_PORT, 10) || 5100;
const WEB_PORT = parseInt(process.env.E2E_WEB_PORT, 10) || 3100;

module.exports = {
  db,
  API_PORT,
  WEB_PORT,
  API_URL: `http://127.0.0.1:${API_PORT}/api`,
  WEB_URL: `http://127.0.0.1:${WEB_PORT}`,
  JWT_SECRET: 'e2e_jwt_secret',
  SENHA: 'senha123'
};
