import type { Response } from 'express';
import { normalizarTipo, vencimentoEfetivo, grupoSemana, TipoBoleto } from './boletosSemana';

/** Linha de boletos_notas (colunas de BOLETO_SELECT). NUMERIC chega como string do pg. */
export interface BoletoRow {
  id: number;
  restaurante_id: number;
  usuario_id: number | null;
  dt_recebimento: Date | string | null;
  dt_vencimento: Date | string | null;
  descricao: string | null;
  valor: string | number;
  tipo: string | null;
  created_at: Date;
  updated_at: Date;
}

/** Linha de boletos_metas_gasto (colunas de META_SELECT). */
export interface MetaRow {
  id: number;
  restaurante_id: number;
  data_referencia: Date | string | null;
  semana_chave: string;
  semana_inicio: Date | string | null;
  semana_fim: Date | string | null;
  maximo_gasto: string | number;
  created_at: Date;
  updated_at: Date;
}

export interface BoletoEnriquecido {
  id: number;
  restaurante_id: number;
  usuario_id: number | null;
  dt_recebimento: string | null;
  dt_vencimento: string | null;
  descricao: string;
  valor: number;
  tipo: TipoBoleto;
  dt_vencimento_efetivo: string | null;
  semana_chave: string | null;
  semana_inicio: string | null;
  semana_fim: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface MetaEnriquecida {
  id: number;
  restaurante_id: number;
  data_referencia: string | null;
  semana_chave: string;
  semana_inicio: string | null;
  semana_fim: string | null;
  maximo_gasto: number;
  created_at: Date;
  updated_at: Date;
}

export function hojeBrasil(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
}

export function dateToIso(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === 'string') {
    const text = value.slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  return null;
}

// Limite de NUMERIC(14,2): 12 dígitos inteiros. Acima disso o Postgres devolve erro (500).
export const VALOR_BOLETO_MAX = 999999999999.99;

export function parseValorBoleto(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === '') return null;
  let value: number;
  if (typeof raw === 'number') {
    value = raw;
  } else {
    const text = String(raw).trim().replace(/\s/g, '').replace(/^R\$/i, '');
    if (!text) return null;
    const normalized = text.includes(',') ? text.replace(/\./g, '').replace(',', '.') : text;
    value = Number(normalized);
  }
  if (!Number.isFinite(value) || value < 0 || value > VALOR_BOLETO_MAX) return null;
  return Math.round(value * 100) / 100;
}

export function erroTabelaBoletos(error: unknown, res: Response): boolean {
  const code = (error as { code?: string } | null)?.code;
  if (code === '42P01' || code === '42703') {
    res.status(503).json({ error: 'Módulo de boletos não instalado. Rode a migração 014.' });
    return true;
  }
  return false;
}

export function enriquecerBoleto(row: BoletoRow): BoletoEnriquecido {
  const dtRecebimento = dateToIso(row.dt_recebimento);
  const dtVencimento = dateToIso(row.dt_vencimento);
  const tipo = normalizarTipo(row.tipo);
  const efetivo = vencimentoEfetivo(dtRecebimento, dtVencimento, tipo);
  const semana = grupoSemana(dtRecebimento, dtVencimento, tipo);
  return {
    id: row.id,
    restaurante_id: row.restaurante_id,
    usuario_id: row.usuario_id,
    dt_recebimento: dtRecebimento,
    dt_vencimento: dtVencimento,
    descricao: row.descricao || '',
    valor: Number(row.valor),
    tipo,
    dt_vencimento_efetivo: efetivo,
    semana_chave: semana ? semana.chave : null,
    semana_inicio: semana ? semana.inicio : null,
    semana_fim: semana ? semana.fim : null,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

export function enriquecerMeta(row: MetaRow): MetaEnriquecida {
  return {
    id: row.id,
    restaurante_id: row.restaurante_id,
    data_referencia: dateToIso(row.data_referencia),
    semana_chave: row.semana_chave,
    semana_inicio: dateToIso(row.semana_inicio),
    semana_fim: dateToIso(row.semana_fim),
    maximo_gasto: Number(row.maximo_gasto),
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

export const BOLETO_SELECT = `id, restaurante_id, usuario_id, dt_recebimento, dt_vencimento, descricao, valor, tipo, created_at, updated_at`;
export const META_SELECT = `id, restaurante_id, data_referencia, semana_chave, semana_inicio, semana_fim, maximo_gasto, created_at, updated_at`;

export function parseDateOnly(s: unknown): string | null {
  if (!s || typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T12:00:00Z`);
  // Rejeita datas impossíveis (ex.: 2026-02-31), que o JS "rola" para o mês seguinte.
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s ? null : s;
}
