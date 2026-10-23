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

const { configMinio, envStorage } = require('../../backend/test/helpers/minio');

const API_PORT = parseInt(process.env.E2E_API_PORT, 10) || 5100;
const WEB_PORT = parseInt(process.env.E2E_WEB_PORT, 10) || 3100;

const GEMINI_MOCK_PORT = parseInt(process.env.E2E_GEMINI_PORT, 10) || 5190;
// Linha digitável válida (47 dígitos) que o Gemini falso devolve; a mesma usada nos testes mockados.
const LINHA_GEMINI_MOCK = '34190000090000000000000000079327799990000001081';

// MinIO de teste (o mesmo container do Jest); o bucket precisa terminar em "-test". Pode estar fora do ar: os
// testes que dependem dele PULAM (ver fixtures.minioPronto).
const minio = configMinio();

module.exports = {
  db,
  minio,
  envStorage: envStorage(minio),
  GEMINI_MOCK_PORT,
  LINHA_GEMINI_MOCK,
  LIMITE_DIARIO_E2E: 5,
  API_PORT,
  WEB_PORT,
  API_URL: `http://127.0.0.1:${API_PORT}/api`,
  WEB_URL: `http://127.0.0.1:${WEB_PORT}`,
  JWT_SECRET: 'e2e_jwt_secret',
  SENHA: 'senha123'
};
