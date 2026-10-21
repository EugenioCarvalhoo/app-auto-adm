const { normalizarTipo, vencimentoEfetivo, grupoSemana } = require('./boletosSemana');

function hojeBrasil() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
}

function dateToIso(value) {
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
const VALOR_BOLETO_MAX = 999999999999.99;

function parseValorBoleto(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  let value;
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

function erroTabelaBoletos(error, res) {
  if (error.code === '42P01' || error.code === '42703') {
    res.status(503).json({ error: 'Módulo de boletos não instalado. Rode a migração 014.' });
    return true;
  }
  return false;
}

function enriquecerBoleto(row) {
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

function enriquecerMeta(row) {
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

const BOLETO_SELECT = `id, restaurante_id, usuario_id, dt_recebimento, dt_vencimento, descricao, valor, tipo, created_at, updated_at`;
const META_SELECT = `id, restaurante_id, data_referencia, semana_chave, semana_inicio, semana_fim, maximo_gasto, created_at, updated_at`;

function parseDateOnly(s) {
  if (!s || typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T12:00:00Z`);
  // Rejeita datas impossíveis (ex.: 2026-02-31), que o JS "rola" para o mês seguinte.
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s ? null : s;
}

module.exports = {
  hojeBrasil,
  dateToIso,
  parseValorBoleto,
  erroTabelaBoletos,
  enriquecerBoleto,
  enriquecerMeta,
  parseDateOnly,
  BOLETO_SELECT,
  META_SELECT
};
