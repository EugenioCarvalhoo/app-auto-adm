import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

// Carrega backend/.env tanto rodando o TS direto (lib/ -> ../.env) quanto compilado (dist/lib/ -> ../../.env).
// Importe este módulo ANTES dos que leem process.env na carga (ex.: db.ts).
for (const rel of [['..', '.env'], ['..', '..', '.env']]) {
  const file = path.join(__dirname, ...rel);
  if (fs.existsSync(file)) {
    dotenv.config({ path: file });
    break;
  }
}
