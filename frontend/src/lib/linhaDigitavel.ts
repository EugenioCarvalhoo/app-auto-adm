/** Mantém só dígitos (máx. 48). */
export function somenteDigitos(valor: string): string {
  return valor.replace(/\D/g, '').slice(0, 48);
}

/**
 * Formata a linha digitável em blocos legíveis.
 * 47 dígitos (boleto): 5.5 5.6 5.6 1 14; 48 (concessionária): 4 blocos de 12; demais: blocos de 5.
 */
export function formatarLinhaDigitavel(valor: string): string {
  const d = somenteDigitos(valor);
  const corta = (tamanhos: number[]): string => {
    const partes: string[] = [];
    let pos = 0;
    for (const t of tamanhos) {
      if (pos >= d.length) break;
      partes.push(d.slice(pos, pos + t));
      pos += t;
    }
    return partes.join(' ');
  };
  if (d.length === 47) {
    return `${d.slice(0, 5)}.${d.slice(5, 10)} ${d.slice(10, 15)}.${d.slice(15, 21)} ${d.slice(21, 26)}.${d.slice(26, 32)} ${d.slice(32, 33)} ${d.slice(33)}`;
  }
  if (d.length === 48) return corta([12, 12, 12, 12]);
  return corta(new Array<number>(10).fill(5));
}
