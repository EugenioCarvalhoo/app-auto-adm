export const SAUDE_BANCO = Symbol('SaudeBanco');
export const MIGRACOES_PENDENTES = Symbol('MigracoesPendentes');

export interface SaudeBanco {
  /** Lança se o banco não responder. */
  ping(): Promise<void>;
}

export interface ConsultaMigracoesPendentes {
  /** Migrations da lista oficial ausentes em schema_migrations, na ordem da lista. */
  listar(): Promise<string[]>;
}
