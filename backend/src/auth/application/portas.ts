export const USUARIOS_AUTH_REPOSITORY = Symbol('UsuariosAuthRepository');
export const PASSWORD_HASHER = Symbol('PasswordHasher');

/** Linha de usuarios necessária à autenticação. */
export interface UsuarioAuth {
  id: number;
  username: string;
  nome: string;
  password: string;
}

export interface UsuariosAuthRepository {
  buscarPorUsername(username: string): Promise<UsuarioAuth | null>;
  buscarPorId(id: number): Promise<UsuarioAuth | null>;
}

export interface PasswordHasher {
  comparar(senha: string, hash: string): Promise<boolean>;
  gerar(senha: string): Promise<string>;
}
