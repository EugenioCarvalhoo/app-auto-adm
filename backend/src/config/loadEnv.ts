import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

// Carrega backend/.env tanto rodando o TS direto (src/config -> ../../.env) quanto compilado
// (dist/config -> ../../.env; no Docker /app/.env). Se o primeiro não existe, tenta um nível acima.
// Importe este módulo ANTES dos que leem process.env na carga.
for (const rel of [['..', '..', '.env'], ['..', '..', '..', '.env']]) {
  const file = path.join(__dirname, ...rel);
  if (fs.existsSync(file)) {
    dotenv.config({ path: file });
    break;
  }
}
