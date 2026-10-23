import type { Tela, UsuarioPermissao } from '../types';

export interface Permissoes {
  admin: boolean;
  boletos: boolean;
  /** Marcar boleto como pago. */
  pagar: boolean;
}

/** Permissões efetivas do usuário (admin = tudo). */
export function permissoesUsuario(user: UsuarioPermissao | null | undefined): Permissoes {
  if (!user) return { admin: false, boletos: false, pagar: false };
  if (user.is_admin) return { admin: true, boletos: true, pagar: true };
  const boletos = !!user.modulo_boletos;
  return { admin: false, boletos, pagar: boletos && !!user.pode_marcar_pago };
}

export function usuarioTemAlgumModulo(user: UsuarioPermissao | null | undefined): boolean {
  const p = permissoesUsuario(user);
  return p.admin || p.boletos;
}

/** Restaurantes restritos: todo usuário não-admin só vê os restaurantes liberados pelo admin. */
export function usuarioRestaurantesRestritos(user: UsuarioPermissao | null | undefined): boolean {
  return !!user && !user.is_admin;
}

export function telaInicialUsuario(user: UsuarioPermissao | null | undefined): Tela {
  if (user?.is_admin) return 'inicio';
  return 'boletos';
}
