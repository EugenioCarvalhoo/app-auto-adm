/** Normaliza o nome do fornecedor para comparação: minúsculas, sem acento, espaços colapsados. */
export function normalizarFornecedor(raw: unknown): string {
  if (raw === null || raw === undefined) return '';
  return String(raw)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export const FORNECEDOR_MAX = 200;

/** Entrada de fornecedor aceita pela API: ausente/null ou string. Outros tipos (objeto, número, array) => 400 nas rotas. */
export function fornecedorValido(raw: unknown): boolean {
  return raw === null || raw === undefined || typeof raw === 'string';
}

/**
 * Texto de fornecedor para gravar: sem caracteres de controle, espaços colapsados, limitado. null se vazio.
 * Entrada que não seja string vira null (nunca usa String() em objeto); as rotas rejeitam antes com 400 via `fornecedorValido`.
 */
export function sanearFornecedor(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  const texto = raw.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, FORNECEDOR_MAX);
  return texto || null;
}
