import fs from 'fs';
import path from 'path';
import type { Pool } from 'pg';
import { ehTabelaInexistente } from './erros';

interface ListaMigrations {
  MIGRATIONS: string[];
}

// Rodando TS direto (lib/ -> ../database) ou compilado (dist/lib/ -> ../../database; no Docker /app/dist e /app/database).
function carregarLista(): string[] {
  for (const rel of [['..', 'database'], ['..', '..', 'database']]) {
    const dir = path.join(__dirname, ...rel);
    if (fs.existsSync(path.join(dir, 'lista-migrations.js'))) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const lista = require(path.join(dir, 'lista-migrations')) as ListaMigrations;
      return lista.MIGRATIONS;
    }
  }
  throw new Error('database/lista-migrations.js não encontrado');
}

/** Migrations de lista-migrations.js ausentes em schema_migrations, na ordem da lista. */
export async function migracoesPendentes(pool: Pool): Promise<string[]> {
  const todas = carregarLista();
  try {
    const r = await pool.query<{ filename: string }>('SELECT filename FROM schema_migrations');
    const aplicadas = new Set(r.rows.map((row) => row.filename));
    return todas.filter((m) => !aplicadas.has(m));
  } catch (error) {
    if (ehTabelaInexistente(error)) return [...todas];
    throw error;
  }
}
