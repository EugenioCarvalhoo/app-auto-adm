/** Espelho das funções da planilha usadas na tela antes de salvar. */

export interface IntervaloSemana {
  inicio: string;
  fim: string;
  chave: string;
}

function parseIsoDate(iso: string | null | undefined): Date | null {
  if (!iso) return null;
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

function formatIso(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function weekdayMonday1(date: Date): number {
  const js = date.getUTCDay();
  return js === 0 ? 7 : js;
}

export function intervaloSemana(iso: string | null | undefined): IntervaloSemana | null {
  const date = parseIsoDate(iso);
  if (!date) return null;
  const sabado = addDays(date, -((weekdayMonday1(date) + 1) % 7));
  const sexta = addDays(sabado, 6);
  const inicio = formatIso(sabado);
  const fim = formatIso(sexta);
  return {
    inicio,
    fim,
    chave: `${inicio.replace(/-/g, '')}.${fim.replace(/-/g, '')}`
  };
}

export function addDaysIso(iso: string | null | undefined, days: number): string | null {
  const date = parseIsoDate(iso || '');
  if (!date) return null;
  return formatIso(addDays(date, days));
}

export function vencimentoEfetivo(
  dtRecebimento: string,
  dtVencimento: string,
  tipo: string
): string | null {
  const recebimento = parseIsoDate(dtRecebimento) ? dtRecebimento.slice(0, 10) : null;
  const vencimento = parseIsoDate(dtVencimento) ? dtVencimento.slice(0, 10) : null;
  if (!recebimento && !vencimento) return null;
  if (tipo === 'Sem Boleto') return recebimento ? addDaysIso(recebimento, 7) : null;
  return vencimento;
}

export function grupoSemana(
  dtRecebimento: string,
  dtVencimento: string,
  tipo: string
): IntervaloSemana | null {
  if (!parseIsoDate(dtRecebimento)) return null;
  const efetivo = vencimentoEfetivo(dtRecebimento, dtVencimento, tipo);
  if (!efetivo) return null;
  return intervaloSemana(efetivo);
}

export function formatarDataBr(iso: string | null | undefined): string {
  if (!iso) return '';
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!match) return iso;
  return `${match[3]}/${match[2]}/${match[1]}`;
}

export function formatarMoeda(valor: number): string {
  return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function parseValorBr(raw: string): number | null {
  const text = String(raw || '')
    .trim()
    .replace(/\s/g, '')
    .replace(/^R\$/i, '');
  if (!text) return null;
  const normalized = text.includes(',') ? text.replace(/\./g, '').replace(',', '.') : text;
  const value = Number(normalized);
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 100) / 100;
}
