import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import { PG_POOL } from '../../shared/infrastructure/database/tokens';
import type { LimiteDiario } from '../application/extracao.portas';

@Injectable()
export class PgLimiteDiarioRepository implements LimiteDiario {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async reservar(usuarioId: number, dia: string, limite: number): Promise<boolean> {
    // Upsert atômico: o WHERE do DO UPDATE impede passar do limite mesmo com requisições simultâneas.
    const r = await this.pool.query<{ total: number }>(
      `INSERT INTO boletos_extracoes_uso (usuario_id, dia, total)
       VALUES ($1, $2, 1)
       ON CONFLICT (usuario_id, dia) DO UPDATE
         SET total = boletos_extracoes_uso.total + 1, updated_at = now()
         WHERE boletos_extracoes_uso.total < $3
       RETURNING total`,
      [usuarioId, dia, limite]
    );
    return (r.rowCount ?? 0) > 0;
  }

  async devolver(usuarioId: number, dia: string): Promise<void> {
    await this.pool.query(
      `UPDATE boletos_extracoes_uso SET total = GREATEST(total - 1, 0), updated_at = now()
       WHERE usuario_id = $1 AND dia = $2`,
      [usuarioId, dia]
    );
  }
}
