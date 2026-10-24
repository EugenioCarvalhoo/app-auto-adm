import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import { PG_POOL } from '../../shared/infrastructure/database/tokens';
import type { DadosRestaurante, Restaurante } from '../domain/restaurante';
import type { RestaurantesRepository } from '../application/portas';

@Injectable()
export class PgRestaurantesRepository implements RestaurantesRepository {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async listarAtivos(): Promise<Restaurante[]> {
    const result = await this.pool.query<Restaurante>('SELECT * FROM restaurantes WHERE ativo = true ORDER BY nome ASC');
    return result.rows;
  }

  async listarAtivosDoUsuario(userId: number): Promise<Restaurante[]> {
    const result = await this.pool.query<Restaurante>(
      `SELECT r.*
         FROM restaurantes r
         INNER JOIN usuario_restaurantes ur ON ur.restaurante_id = r.id AND ur.usuario_id = $1
         WHERE r.ativo = true
         ORDER BY r.nome ASC`,
      [userId]
    );
    return result.rows;
  }

  async buscarPorId(id: string): Promise<Restaurante | null> {
    const result = await this.pool.query<Restaurante>('SELECT * FROM restaurantes WHERE id = $1', [id]);
    return result.rows[0] ?? null;
  }

  async criar(d: DadosRestaurante): Promise<Restaurante> {
    const result = await this.pool.query<Restaurante>(
      'INSERT INTO restaurantes (nome, endereco, telefone, email, cnpj, observacoes) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
      [d.nome, d.endereco, d.telefone, d.email, d.cnpj, d.observacoes]
    );
    return result.rows[0] as Restaurante;
  }

  async atualizar(id: string, d: DadosRestaurante, ativo: unknown): Promise<Restaurante | null> {
    const result = await this.pool.query<Restaurante>(
      'UPDATE restaurantes SET nome = $1, endereco = $2, telefone = $3, email = $4, cnpj = $5, observacoes = $6, ativo = $7, updated_at = CURRENT_TIMESTAMP WHERE id = $8 RETURNING *',
      [d.nome, d.endereco, d.telefone, d.email, d.cnpj, d.observacoes, ativo !== undefined ? ativo : true, id]
    );
    return result.rows[0] ?? null;
  }

  async desativar(id: string): Promise<boolean> {
    const result = await this.pool.query(
      'UPDATE restaurantes SET ativo = false, updated_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING *',
      [id]
    );
    return result.rows.length > 0;
  }
}
