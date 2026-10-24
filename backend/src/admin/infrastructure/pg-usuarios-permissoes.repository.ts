import { Inject, Injectable } from '@nestjs/common';
import type { Pool, PoolClient } from 'pg';
import type { Queryable } from '../../shared/infrastructure/database/queryable';
import { PG_POOL } from '../../shared/infrastructure/database/tokens';
import type {
  NovoUsuario,
  SessaoPermissoes,
  UsuarioBasico,
  UsuarioPermissoesRow,
  UsuariosPermissoesRepository
} from '../application/portas';

@Injectable()
export class PgUsuariosPermissoesRepository implements UsuariosPermissoesRepository {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async listarTodos(): Promise<UsuarioPermissoesRow[]> {
    const result = await this.pool.query<UsuarioPermissoesRow>(
      `SELECT u.id, u.username, u.nome, u.is_admin,
        COALESCE(u.modulo_boletos, false) AS modulo_boletos
       FROM usuarios u
       ORDER BY u.is_admin DESC, u.nome ASC`
    );
    return result.rows;
  }

  restauranteIdsDoUsuario(userId: number): Promise<number[]> {
    return listarRestauranteIds(this.pool, userId);
  }

  async buscarPorId(id: number): Promise<UsuarioBasico | null> {
    const cur = await this.pool.query<UsuarioBasico>('SELECT id, username, nome, is_admin FROM usuarios WHERE id = $1', [id]);
    return cur.rows[0] ?? null;
  }

  async remover(userId: number): Promise<void> {
    await this.pool.query('DELETE FROM usuarios WHERE id = $1', [userId]);
  }

  async comSessao<T>(operacao: (sessao: SessaoPermissoes) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      return await operacao(new SessaoPg(client));
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }
}

class SessaoPg implements SessaoPermissoes {
  constructor(private readonly client: PoolClient) {}

  async existeUsername(username: string): Promise<boolean> {
    const dup = await this.client.query('SELECT id FROM usuarios WHERE username = $1', [username]);
    return dup.rows.length > 0;
  }

  async buscarUsuario(id: number): Promise<UsuarioBasico | null> {
    const cur = await this.client.query<UsuarioBasico>('SELECT * FROM usuarios WHERE id = $1', [id]);
    return cur.rows[0] ?? null;
  }

  restauranteIdsDoUsuario(userId: number): Promise<number[]> {
    return listarRestauranteIds(this.client, userId);
  }

  async iniciarTransacao(): Promise<void> {
    await this.client.query('BEGIN');
  }

  async confirmar(): Promise<void> {
    await this.client.query('COMMIT');
  }

  async desfazer(): Promise<void> {
    await this.client.query('ROLLBACK');
  }

  async inserirUsuario(novo: NovoUsuario): Promise<{ id: number; username: string; nome: string }> {
    const ins = await this.client.query<{ id: number; username: string; nome: string }>(
      `INSERT INTO usuarios (username, password, nome, is_admin, modulo_boletos)
       VALUES ($1, $2, $3, false, $4)
       RETURNING id, username, nome`,
      [novo.username, novo.senhaHash, novo.nome, novo.moduloBoletos]
    );
    return ins.rows[0] as { id: number; username: string; nome: string };
  }

  async atualizarModuloBoletos(userId: number, moduloBoletos: boolean): Promise<void> {
    await this.client.query(
      `UPDATE usuarios
       SET modulo_boletos = $1,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $2`,
      [moduloBoletos, userId]
    );
  }

  async sincronizarRestaurantes(userId: number, restauranteIds: number[]): Promise<number[]> {
    await this.client.query('DELETE FROM usuario_restaurantes WHERE usuario_id = $1', [userId]);
    const ids = [...new Set(restauranteIds)];
    for (const rid of ids) {
      const ex = await this.client.query('SELECT id FROM restaurantes WHERE id = $1 AND ativo = true', [rid]);
      if (ex.rows.length === 0) continue;
      await this.client.query(
        `INSERT INTO usuario_restaurantes (usuario_id, restaurante_id) VALUES ($1, $2)
       ON CONFLICT (usuario_id, restaurante_id) DO NOTHING`,
        [userId, rid]
      );
    }
    return listarRestauranteIds(this.client, userId);
  }
}

async function listarRestauranteIds(db: Queryable, userId: number): Promise<number[]> {
  const assoc = await db.query<{ restaurante_id: number }>(
    'SELECT restaurante_id FROM usuario_restaurantes WHERE usuario_id = $1 ORDER BY restaurante_id',
    [userId]
  );
  return assoc.rows.map((row) => row.restaurante_id);
}
