import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import { PG_POOL } from '../../shared/infrastructure/database/tokens';
import { montarFlags } from '../domain/regras';
import type { UserFlags } from '../domain/regras';
import type { AcessoRepository } from '../application/portas';

@Injectable()
export class PgAcessoRepository implements AcessoRepository {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async carregarFlags(userId: number): Promise<UserFlags | null> {
    const r = await this.pool.query<{ id: number; is_admin: boolean | null; modulo_boletos: boolean | null }>(
      'SELECT id, is_admin, COALESCE(modulo_boletos, false) AS modulo_boletos FROM usuarios WHERE id = $1',
      [userId]
    );
    const row = r.rows[0];
    return row ? montarFlags(row) : null;
  }

  async restauranteIdsDoUsuario(userId: number): Promise<number[]> {
    const r = await this.pool.query<{ restaurante_id: number }>(
      'SELECT restaurante_id FROM usuario_restaurantes WHERE usuario_id = $1 ORDER BY restaurante_id',
      [userId]
    );
    return r.rows.map((row) => row.restaurante_id);
  }

  async usuarioPodeRestaurante(userId: number, restauranteId: number): Promise<boolean> {
    const r = await this.pool.query(
      'SELECT 1 FROM usuario_restaurantes WHERE usuario_id = $1 AND restaurante_id = $2',
      [userId, restauranteId]
    );
    return r.rows.length > 0;
  }
}
