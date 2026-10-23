/** Código SQLSTATE do pg (ex.: '23505') quando o erro o traz; senão undefined. */
export function codigoErro(error: unknown): string | undefined {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === 'string' ? code : undefined;
  }
  return undefined;
}

export const MSG_BANCO_DESATUALIZADO = 'Banco desatualizado: migrations pendentes. Veja /api/health/ready.';

/** True para 42P01 (tabela/relação inexistente): sinal de migration pendente. */
export function ehTabelaInexistente(error: unknown): boolean {
  return codigoErro(error) === '42P01';
}

export function mensagemErro(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function stackErro(error: unknown): string | undefined {
  return error instanceof Error ? error.stack : undefined;
}
