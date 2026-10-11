/**
 * Funções nomeadas da planilha "Cadastramento de Boletos e Notas".
 * INTERVALOSEMANA agrupa por sábado–sexta.
 * MES_SEMANA e SEMANA_MES existem na planilha e não são usadas em células.
 */

function parseIsoDate(iso) {
  if (iso == null || iso === '') return null;
  const text = String(iso).slice(0, 10);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date;
}

function formatIso(date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function compactIso(date) {
  return formatIso(date).replace(/-/g, '');
}

function addDays(date, days) {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

/** Excel WEEKDAY(date, 2): segunda = 1 … domingo = 7. */
function weekdayMonday1(date) {
  const js = date.getUTCDay();
  return js === 0 ? 7 : js;
}

/** Excel WEEKDAY(date, 1): domingo = 1 … sábado = 7. */
function weekdaySunday1(date) {
  return date.getUTCDay() + 1;
}

/**
 * Excel WEEKNUM(date, 16): semana começa na segunda e a semana que contém 1º de janeiro é a semana 1.
 */
function weekNumMondaySystem1(date) {
  const jan1 = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const mondayOfJan1 = addDays(jan1, -(weekdayMonday1(jan1) - 1));
  const diffDays = Math.round((date.getTime() - mondayOfJan1.getTime()) / 86400000);
  return Math.floor(diffDays / 7) + 1;
}

function intervaloSemana(iso) {
  const date = parseIsoDate(iso);
  if (!date) return null;
  const sabado = addDays(date, -((weekdayMonday1(date) + 1) % 7));
  const sexta = addDays(sabado, 6);
  return {
    inicio: formatIso(sabado),
    fim: formatIso(sexta),
    chave: `${compactIso(sabado)}.${compactIso(sexta)}`
  };
}

function mesSemana(iso) {
  const date = parseIsoDate(iso);
  if (!date) return '';
  const segunda = addDays(date, -((weekdayMonday1(date) - 1) % 7));
  const primeiro = new Date(Date.UTC(segunda.getUTCFullYear(), segunda.getUTCMonth(), 1));
  const numero = weekNumMondaySystem1(segunda) - weekNumMondaySystem1(primeiro) + 1;
  const month = String(segunda.getUTCMonth() + 1).padStart(2, '0');
  return month + String(numero).padStart(2, '0');
}

function semanaMes(iso) {
  const date = parseIsoDate(iso);
  if (!date) return '';
  const ancora = addDays(date, -((weekdaySunday1(date) + 1) % 7));
  const numero = Math.floor((ancora.getUTCDate() - 1) / 7) + 1;
  const month = String(ancora.getUTCMonth() + 1).padStart(2, '0');
  return month + String(numero).padStart(2, '0');
}

function addDaysIso(iso, days) {
  const date = parseIsoDate(iso);
  if (!date) return null;
  return formatIso(addDays(date, days));
}

function normalizarTipo(tipo) {
  const text = String(tipo || '').trim().toLowerCase();
  if (text === 'sem boleto' || text === 'sem_boleto') return 'Sem Boleto';
  return 'Boleto';
}

/** Vencimento usado no agrupamento: sem boleto = recebimento + 7 dias. */
function vencimentoEfetivo(dtRecebimento, dtVencimento, tipo) {
  const recebimento = parseIsoDate(dtRecebimento) ? String(dtRecebimento).slice(0, 10) : null;
  const vencimento = parseIsoDate(dtVencimento) ? String(dtVencimento).slice(0, 10) : null;
  if (!recebimento && !vencimento) return null;
  if (normalizarTipo(tipo) === 'Sem Boleto') {
    return recebimento ? addDaysIso(recebimento, 7) : null;
  }
  return vencimento;
}

/** Semana do vencimento efetivo. Linha sem data de recebimento fica fora do total. */
function grupoSemana(dtRecebimento, dtVencimento, tipo) {
  const recebimento = parseIsoDate(dtRecebimento) ? String(dtRecebimento).slice(0, 10) : null;
  if (!recebimento) return null;
  const efetivo = vencimentoEfetivo(recebimento, dtVencimento, tipo);
  if (!efetivo) return null;
  return intervaloSemana(efetivo);
}

module.exports = {
  parseIsoDate,
  formatIso,
  intervaloSemana,
  mesSemana,
  semanaMes,
  addDaysIso,
  normalizarTipo,
  vencimentoEfetivo,
  grupoSemana
};
