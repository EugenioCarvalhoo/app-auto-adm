import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import { PG_POOL } from '../../shared/infrastructure/database/tokens';
import type { BoletoRow, MetaRow } from '../domain/boleto';
import type {
  AlteracaoBoleto,
  BoletosRepository,
  DadosMeta,
  MetasRepository,
  NovoBoleto
} from '../application/portas';

const BOLETO_SELECT = `id, restaurante_id, usuario_id, dt_recebimento, dt_vencimento, descricao, valor, tipo, created_at, updated_at`;
const META_SELECT = `id, restaurante_id, data_referencia, semana_chave, semana_inicio, semana_fim, maximo_gasto, created_at, updated_at`;

@Injectable()
export class PgBoletosRepository implements BoletosRepository {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async listarPorRecebimentoAsc(restauranteId: number): Promise<BoletoRow[]> {
    const r = await this.pool.query<BoletoRow>(
      `SELECT ${BOLETO_SELECT} FROM boletos_notas WHERE restaurante_id = $1 ORDER BY dt_recebimento ASC, id ASC`,
      [restauranteId]
    );
    return r.rows;
  }

  async listarPorRestaurante(restauranteId: number): Promise<BoletoRow[]> {
    const r = await this.pool.query<BoletoRow>(
      `SELECT ${BOLETO_SELECT} FROM boletos_notas WHERE restaurante_id = $1 ORDER BY dt_recebimento DESC NULLS LAST, id DESC`,
      [restauranteId]
    );
    return r.rows;
  }

  async inserir(n: NovoBoleto): Promise<BoletoRow> {
    const r = await this.pool.query<BoletoRow>(
      `INSERT INTO boletos_notas (restaurante_id, usuario_id, dt_recebimento, dt_vencimento, descricao, valor, tipo)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING ${BOLETO_SELECT}`,
      [n.restauranteId, n.usuarioId, n.dtRecebimento, n.dtVencimento, n.descricao, n.valor, n.tipo]
    );
    return r.rows[0] as BoletoRow;
  }

  async buscarPorId(id: number): Promise<BoletoRow | null> {
    const r = await this.pool.query<BoletoRow>(`SELECT ${BOLETO_SELECT} FROM boletos_notas WHERE id = $1`, [id]);
    return r.rows[0] ?? null;
  }

  async atualizar(id: number, a: AlteracaoBoleto): Promise<BoletoRow> {
    const r = await this.pool.query<BoletoRow>(
      `UPDATE boletos_notas
       SET dt_recebimento = $1, dt_vencimento = $2, descricao = $3, valor = $4, tipo = $5, updated_at = CURRENT_TIMESTAMP
       WHERE id = $6
       RETURNING ${BOLETO_SELECT}`,
      [a.dtRecebimento, a.dtVencimento, a.descricao, a.valor, a.tipo, id]
    );
    return r.rows[0] as BoletoRow;
  }

  async buscarParaExclusao(id: number): Promise<{ restaurante_id: number; created_at: Date } | null> {
    const r = await this.pool.query<{ restaurante_id: number; created_at: Date }>(
      'SELECT restaurante_id, created_at FROM boletos_notas WHERE id = $1',
      [id]
    );
    return r.rows[0] ?? null;
  }

  async excluir(id: number): Promise<void> {
    await this.pool.query('DELETE FROM boletos_notas WHERE id = $1', [id]);
  }
}

@Injectable()
export class PgMetasRepository implements MetasRepository {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async listarPorSemanaAsc(restauranteId: number): Promise<MetaRow[]> {
    const r = await this.pool.query<MetaRow>(
      `SELECT ${META_SELECT} FROM boletos_metas_gasto WHERE restaurante_id = $1 ORDER BY semana_inicio ASC`,
      [restauranteId]
    );
    return r.rows;
  }

  async listarPorSemanaDesc(restauranteId: number): Promise<MetaRow[]> {
    const r = await this.pool.query<MetaRow>(
      `SELECT ${META_SELECT} FROM boletos_metas_gasto WHERE restaurante_id = $1 ORDER BY semana_inicio DESC`,
      [restauranteId]
    );
    return r.rows;
  }

  async salvar(restauranteId: number, d: DadosMeta): Promise<MetaRow> {
    const r = await this.pool.query<MetaRow>(
      `INSERT INTO boletos_metas_gasto (restaurante_id, data_referencia, semana_chave, semana_inicio, semana_fim, maximo_gasto)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (restaurante_id, semana_chave)
       DO UPDATE SET data_referencia = EXCLUDED.data_referencia,
                     maximo_gasto = EXCLUDED.maximo_gasto,
                     updated_at = CURRENT_TIMESTAMP
       RETURNING ${META_SELECT}`,
      [restauranteId, d.dataReferencia, d.semanaChave, d.semanaInicio, d.semanaFim, d.maximoGasto]
    );
    return r.rows[0] as MetaRow;
  }

  async buscarPorId(id: number): Promise<MetaRow | null> {
    const r = await this.pool.query<MetaRow>(`SELECT ${META_SELECT} FROM boletos_metas_gasto WHERE id = $1`, [id]);
    return r.rows[0] ?? null;
  }

  async atualizar(id: number, d: DadosMeta): Promise<MetaRow> {
    const r = await this.pool.query<MetaRow>(
      `UPDATE boletos_metas_gasto
       SET data_referencia = $1, semana_chave = $2, semana_inicio = $3, semana_fim = $4, maximo_gasto = $5, updated_at = CURRENT_TIMESTAMP
       WHERE id = $6
       RETURNING ${META_SELECT}`,
      [d.dataReferencia, d.semanaChave, d.semanaInicio, d.semanaFim, d.maximoGasto, id]
    );
    return r.rows[0] as MetaRow;
  }

  async buscarRestauranteId(id: number): Promise<number | null> {
    const r = await this.pool.query<{ restaurante_id: number }>(
      'SELECT restaurante_id FROM boletos_metas_gasto WHERE id = $1',
      [id]
    );
    return r.rows[0]?.restaurante_id ?? null;
  }

  async excluir(id: number): Promise<void> {
    await this.pool.query('DELETE FROM boletos_metas_gasto WHERE id = $1', [id]);
  }
}
