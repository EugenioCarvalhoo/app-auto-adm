/**
 * Linha digitável de boleto.
 *
 * Aceita 47 dígitos (boleto bancário) ou 48 dígitos (arrecadação/concessionária).
 * O que `validarLinhaDigitavel` confere:
 *  - somente dígitos após `normalizarLinhaDigitavel` (remove pontos, espaços, hífens etc.);
 *  - comprimento 47 ou 48;
 *  - 47 dígitos: DV de cada um dos 3 primeiros campos (módulo 10) e o DV geral do código de
 *    barras (módulo 11, posição 33). NÃO confere fator de vencimento nem valor;
 *  - 48 dígitos: primeiro dígito '8' (arrecadação), identificador de módulo (3º dígito: 6/7 = módulo 10,
 *    8/9 = módulo 11) e o DV de cada um dos 4 blocos de 12 dígitos. NÃO confere valor nem empresa.
 */

export type MotivoLinhaInvalida = 'vazia' | 'tamanho' | 'dv' | 'formato';

export interface ResultadoLinha {
  valida: boolean;
  /** Linha só com dígitos (sempre preenchida, mesmo se inválida). */
  linha: string;
  motivo?: MotivoLinhaInvalida;
}

/** Remove tudo que não for dígito. */
export function normalizarLinhaDigitavel(raw: unknown): string {
  if (raw === null || raw === undefined) return '';
  return String(raw).replace(/\D/g, '');
}

function digitos(s: string): number[] {
  return s.split('').map((c) => Number(c));
}

/** DV módulo 10: pesos 2,1,2,1... da direita para a esquerda; soma dos algarismos dos produtos. */
export function dvModulo10(base: string): number {
  let soma = 0;
  let peso = 2;
  const ds = digitos(base);
  for (let i = ds.length - 1; i >= 0; i--) {
    const prod = ds[i] * peso;
    soma += prod > 9 ? Math.floor(prod / 10) + (prod % 10) : prod;
    peso = peso === 2 ? 1 : 2;
  }
  const resto = soma % 10;
  return resto === 0 ? 0 : 10 - resto;
}

/** Soma ponderada módulo 11 com pesos 2..9 (cíclicos) da direita para a esquerda. */
function restoModulo11(base: string): number {
  let soma = 0;
  let peso = 2;
  const ds = digitos(base);
  for (let i = ds.length - 1; i >= 0; i--) {
    soma += ds[i] * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }
  return soma % 11;
}

/** DV módulo 11 de arrecadação (Febraban): resto 0 ou 1 => 0; senão 11 - resto. */
export function dvModulo11Arrecadacao(base: string): number {
  const resto = restoModulo11(base);
  return resto === 0 || resto === 1 ? 0 : 11 - resto;
}

/** DV geral do código de barras bancário (43 dígitos, sem o DV): 11 - resto; 0, 10 e 11 viram 1. */
export function dvGeralBancario(base43: string): number {
  const dv = 11 - restoModulo11(base43);
  return dv === 0 || dv === 10 || dv === 11 ? 1 : dv;
}

function validarBancario(l: string): boolean {
  const campos: Array<[string, string]> = [
    [l.slice(0, 9), l[9]],
    [l.slice(10, 20), l[20]],
    [l.slice(21, 31), l[31]]
  ];
  for (const [base, dv] of campos) {
    if (dvModulo10(base) !== Number(dv)) return false;
  }
  // Código de barras de 44 posições: banco+moeda | DV geral | fator+valor | campo livre (25).
  const barras43 = l.slice(0, 4) + l.slice(33, 47) + l.slice(4, 9) + l.slice(10, 20) + l.slice(21, 31);
  return dvGeralBancario(barras43) === Number(l[32]);
}

function validarArrecadacao(l: string): boolean {
  if (l[0] !== '8') return false;
  const idModulo = l[2];
  let calc: (base: string) => number;
  if (idModulo === '6' || idModulo === '7') calc = dvModulo10;
  else if (idModulo === '8' || idModulo === '9') calc = dvModulo11Arrecadacao;
  else return false;
  for (let i = 0; i < 4; i++) {
    const bloco = l.slice(i * 12, i * 12 + 12);
    if (calc(bloco.slice(0, 11)) !== Number(bloco[11])) return false;
  }
  return true;
}

export function validarLinhaDigitavel(raw: unknown): ResultadoLinha {
  const linha = normalizarLinhaDigitavel(raw);
  if (!linha) return { valida: false, linha, motivo: 'vazia' };
  if (linha.length !== 47 && linha.length !== 48) return { valida: false, linha, motivo: 'tamanho' };
  const ok = linha.length === 47 ? validarBancario(linha) : validarArrecadacao(linha);
  return ok ? { valida: true, linha } : { valida: false, linha, motivo: 'dv' };
}

/** Formata para exibição. Entrada inválida/de outro tamanho volta só com os dígitos. */
export function formatarLinhaDigitavel(raw: unknown): string {
  const l = normalizarLinhaDigitavel(raw);
  if (l.length === 47) {
    return `${l.slice(0, 5)}.${l.slice(5, 10)} ${l.slice(10, 15)}.${l.slice(15, 21)} ${l.slice(21, 26)}.${l.slice(26, 32)} ${l[32]} ${l.slice(33)}`;
  }
  if (l.length === 48) {
    return [l.slice(0, 12), l.slice(12, 24), l.slice(24, 36), l.slice(36, 48)].join(' ');
  }
  return l;
}
