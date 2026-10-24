const SECRET_PADRAO = 'sua_chave_secreta_super_segura_aqui';

/** Segredo do JWT lido do ambiente (carregue o .env antes). Avisa quando cai no valor padrão. */
export function obterJwtSecret(): string {
  const secret = process.env.JWT_SECRET || SECRET_PADRAO;
  if (secret === SECRET_PADRAO) {
    console.warn('AVISO: JWT_SECRET não configurado, usando chave padrão. Configure JWT_SECRET no .env para produção!');
  }
  return secret;
}

export function logHttpAtivo(): boolean {
  return process.env.NODE_ENV !== 'test' && process.env.LOG_HTTP !== '0' && process.env.LOG_HTTP !== 'false';
}
