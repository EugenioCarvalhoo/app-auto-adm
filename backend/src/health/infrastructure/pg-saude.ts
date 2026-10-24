import { Inject, Injectable } from '@nestjs/common';
import fs from 'fs';
import path from 'path';
import type { Pool } from 'pg';
import { ehTabelaInexistente } from '../../shared/domain/erros';
import { PG_POOL } from '../../shared/infrastructure/database/tokens';
import type { ConsultaMigracoesPendentes, SaudeBanco } from '../application/portas';

interface ListaMigrations {
  MIGRATIONS: string[];
}

// Sobe a partir deste arquivo até achar database/lista-migrations.js: funciona com o TS direto
// (backend/src/... -> backend/database) e compilado (dist/... -> /app/database no Docker).
function carregarLista(): string[] {
  let dir = __dirname;
  for (let i = 0; i < 8; i++) {
    const candidato = path.join(dir, 'database');
    if (fs.existsSync(path.join(candidato, 'lista-migrations.js'))) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const lista = require(path.join(candidato, 'lista-migrations')) as ListaMigrations;
      return lista.MIGRATIONS;
    }
    const pai = path.dirname(dir);
    if (pai === dir) break;
    dir = pai;
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

@Injectable()
export class PgSaudeBanco implements SaudeBanco {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async ping(): Promise<void> {
    await this.pool.query('SELECT 1');
  }
}

@Injectable()
export class PgMigracoesPendentes implements ConsultaMigracoesPendentes {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  listar(): Promise<string[]> {
    return migracoesPendentes(this.pool);
  }
}
