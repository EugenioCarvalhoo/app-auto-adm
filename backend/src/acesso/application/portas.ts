import type { AuthUser, UserFlags } from '../domain/regras';

export const ACESSO_REPOSITORY = Symbol('AcessoRepository');
export const TOKEN_SERVICE = Symbol('TokenService');

/** Leitura de permissões no armazenamento (sempre do banco, nunca do JWT). */
export interface AcessoRepository {
  carregarFlags(userId: number): Promise<UserFlags | null>;
  restauranteIdsDoUsuario(userId: number): Promise<number[]>;
  usuarioPodeRestaurante(userId: number, restauranteId: number): Promise<boolean>;
}

export interface TokenService {
  assinar(payload: AuthUser, expiraEm: string): string;
  /** Lança se a assinatura for inválida ou o token expirou. */
  verificar(token: string): AuthUser;
}
