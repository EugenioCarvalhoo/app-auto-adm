/** Flags de permissão do usuário, lidas do banco a cada requisição (não confiar no JWT). */
export interface UserFlags {
  id: number;
  is_admin: boolean;
  modulo_boletos: boolean;
}

/** Usuário autenticado: payload do JWT. As flags são só informativas; a autorização lê o banco. */
export interface AuthUser {
  id: number;
  username?: string;
  is_admin?: boolean;
  modulo_boletos?: boolean;
}

/** Usuário como a API o devolve ao cliente. */
export interface UserClient {
  id: number;
  username: string;
  nome: string;
  is_admin: boolean;
  modulo_boletos: boolean;
  restaurante_ids: number[];
}

/** Regra de negócio: só o admin enxerga todos os restaurantes; os demais, apenas os vinculados. */
export function usuarioRestaurantesRestritos(flags: UserFlags | null | undefined): boolean {
  return !!flags && !flags.is_admin;
}

/** Admin sempre tem boletos; os demais dependem de modulo_boletos. */
export function temAcessoModuloBoletos(flags: UserFlags): boolean {
  return flags.is_admin || flags.modulo_boletos;
}

/** Aplica a regra "admin sempre tem boletos" sobre os valores crus do banco. */
export function montarFlags(row: { id: number; is_admin: boolean | null; modulo_boletos: boolean | null }): UserFlags {
  return { id: row.id, is_admin: !!row.is_admin, modulo_boletos: !!row.is_admin || !!row.modulo_boletos };
}
