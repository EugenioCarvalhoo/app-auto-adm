import { normalizarTipo, vencimentoEfetivo, grupoSemana, TipoBoleto } from './boletosSemana';

/** Registro de boletos_notas. NUMERIC chega como string do pg. */
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

/** Registro de boletos_metas_gasto. */
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

export function parseDateOnly(s: unknown): string | null {
  if (!s || typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T12:00:00Z`);
  // Rejeita datas impossíveis (ex.: 2026-02-31), que o JS "rola" para o mês seguinte.
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s ? null : s;
}

export interface SemanaResumo {
  chave: string;
  inicio: string | null;
  fim: string | null;
  total: number;
  quantidade: number;
  maximo: number | null;
}

export interface SemanaResumoComSaldo extends SemanaResumo {
  saldo: number | null;
}

/** Agrupa boletos (total e quantidade) e metas (máximo) por semana sábado–sexta e calcula o saldo. */
export function montarResumoSemanal(
  boletos: BoletoRow[],
  metas: MetaRow[]
): { semanas: SemanaResumoComSaldo[]; total_geral: number } {
  const porSemana = new Map<string, SemanaResumo>();
  boletos.forEach((row) => {
    const item = enriquecerBoleto(row);
    if (!item.semana_chave) return;
    const atual: SemanaResumo = porSemana.get(item.semana_chave) || {
      chave: item.semana_chave,
      inicio: item.semana_inicio,
      fim: item.semana_fim,
      total: 0,
      quantidade: 0,
      maximo: null
    };
    atual.total = Math.round((atual.total + item.valor) * 100) / 100;
    atual.quantidade += 1;
    porSemana.set(item.semana_chave, atual);
  });

  metas.forEach((row) => {
    const meta = enriquecerMeta(row);
    const atual: SemanaResumo = porSemana.get(meta.semana_chave) || {
      chave: meta.semana_chave,
      inicio: meta.semana_inicio,
      fim: meta.semana_fim,
      total: 0,
      quantidade: 0,
      maximo: null
    };
    atual.maximo = meta.maximo_gasto;
    porSemana.set(meta.semana_chave, atual);
  });

  const semanas = [...porSemana.values()]
    .sort((a, b) => a.chave.localeCompare(b.chave))
    .map((semana) => ({
      ...semana,
      saldo: semana.maximo == null ? null : Math.round((semana.maximo - semana.total) * 100) / 100
    }));
  const total_geral = Math.round(semanas.reduce((acc, semana) => acc + semana.total, 0) * 100) / 100;
  return { semanas, total_geral };
}

/** Admin exclui sempre; os demais só até 1 dia após a criação (data inválida conta como "passou"). */
export function podeExcluirLancamento(isAdmin: boolean, criadoEm: Date | string, agoraMs: number): boolean {
  if (isAdmin) return true;
  const criado = new Date(criadoEm).getTime();
  const passouUmDia = !Number.isFinite(criado) || agoraMs - criado > 24 * 60 * 60 * 1000;
  return !passouUmDia;
}
