/** Permissões efetivas do usuário (admin = tudo). */
export function permissoesUsuario(user) {
  if (!user) {
    return { financeiro: false, estoque: false, estoqueSimplificado: false, boletos: false };
  }
  if (user.is_admin) {
    return { financeiro: true, estoque: true, estoqueSimplificado: true, boletos: true };
  }

  const temCamposModulo =
    user.modulo_financeiro !== undefined ||
    user.modulo_estoque !== undefined ||
    user.modulo_estoque_simplificado !== undefined ||
    user.modulo_boletos !== undefined;

  if (!temCamposModulo) {
    if (user.somente_estoque) {
      return { financeiro: false, estoque: true, estoqueSimplificado: false, boletos: false };
    }
    return { financeiro: true, estoque: false, estoqueSimplificado: false, boletos: false };
  }

  return {
    financeiro: !!user.modulo_financeiro,
    estoque: !!user.modulo_estoque,
    estoqueSimplificado: !!user.modulo_estoque_simplificado,
    boletos: !!user.modulo_boletos
  };
}

export function usuarioTemAlgumModulo(user) {
  const p = permissoesUsuario(user);
  return p.financeiro || p.estoque || p.estoqueSimplificado || p.boletos;
}

/** Restaurantes restritos: todo usuário não-admin só vê os restaurantes liberados pelo admin. */
export function usuarioRestaurantesRestritos(user) {
  return !!user && !user.is_admin;
}

export function telaInicialUsuario(user) {
  if (!user) return 'gastos';
  if (user.is_admin) return 'inicio';
  const p = permissoesUsuario(user);
  if (p.financeiro) return 'gastos';
  if (p.boletos) return 'boletos';
  if (p.estoque || p.estoqueSimplificado) return 'estoque';
  return 'gastos';
}

export function estoqueViewInicial(user) {
  const p = permissoesUsuario(user);
  if (p.estoque) return 'resumo';
  if (p.estoqueSimplificado) return 'diario';
  return 'resumo';
}
