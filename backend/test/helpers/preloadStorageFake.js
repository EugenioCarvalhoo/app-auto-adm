/**
 * Preload (node -r) usado só em limparBoletos.test.js. O script roda em processo filho e usa
 * dist/lib/storage.criarStorageS3; aqui ele é trocado por um storage em disco (FAKE_STORAGE_DIR), de modo que o
 * teste inspecione os arquivos. Se ORDEM_LOG estiver definido, registra a cada apagar() se a linha do banco
 * (boleto/anexo) ainda existe naquele instante (prova a ordem "banco antes do arquivo").
 * Se FAKE_APAGAR_FALHA=1, apagar() sempre lança (simula storage fora do ar).
 */
const fs = require('fs');
const { Pool } = require('pg');
const storage = require('../../dist/lib/storage');
const { criarStorageEmDisco } = require('./storageFake');

storage.criarStorageS3 = () => {
  const s = criarStorageEmDisco(process.env.FAKE_STORAGE_DIR);
  const apagar = s.apagar.bind(s);
  s.apagar = async (chave) => {
    if (process.env.ORDEM_LOG) {
      const pool = new Pool({
        user: process.env.DB_USER,
        host: process.env.DB_HOST,
        database: process.env.DB_NAME,
        password: process.env.DB_PASSWORD,
        port: process.env.DB_PORT
      });
      try {
        const r = await pool.query('SELECT count(*)::int AS n FROM boletos_anexos WHERE storage_chave = $1', [chave]);
        fs.appendFileSync(process.env.ORDEM_LOG, `${JSON.stringify({ chave, anexoAindaNoBanco: r.rows[0].n > 0 })}\n`);
      } finally {
        await pool.end();
      }
    }
    if (process.env.FAKE_APAGAR_FALHA === '1') throw new Error('storage fora do ar (simulado)');
    return apagar(chave);
  };
  return s;
};
