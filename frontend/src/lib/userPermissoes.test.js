import {
  permissoesUsuario,
  usuarioTemAlgumModulo,
  usuarioRestaurantesRestritos,
  telaInicialUsuario
} from './userPermissoes';

describe('permissoesUsuario', () => {
  it('sem usuário: nada liberado', () => {
    expect(permissoesUsuario(null)).toEqual({ admin: false, boletos: false });
  });

  it('admin tem todos os módulos', () => {
    expect(permissoesUsuario({ is_admin: true })).toEqual({ admin: true, boletos: true });
  });

  it('usuário comum só tem o que o admin liberou', () => {
    const p = permissoesUsuario({ is_admin: false, modulo_boletos: true });
    expect(p).toEqual({ admin: false, boletos: true });
  });

  it('usuário comum com boletos desligado não tem boletos', () => {
    expect(permissoesUsuario({ is_admin: false, modulo_boletos: false }).boletos).toBe(false);
  });
});

describe('usuarioTemAlgumModulo', () => {
  it('false sem nenhum módulo; true com boletos', () => {
    expect(usuarioTemAlgumModulo({ is_admin: false, modulo_boletos: false })).toBe(false);
    expect(usuarioTemAlgumModulo({ is_admin: false, modulo_boletos: true })).toBe(true);
  });
});

describe('usuarioRestaurantesRestritos (regra: só o admin vê todos)', () => {
  it('admin não é restrito', () => {
    expect(usuarioRestaurantesRestritos({ is_admin: true })).toBe(false);
  });

  it('usuário comum é sempre restrito', () => {
    expect(usuarioRestaurantesRestritos({ is_admin: false, modulo_boletos: true })).toBe(true);
  });

  it('sem usuário: false', () => {
    expect(usuarioRestaurantesRestritos(null)).toBe(false);
  });
});

describe('telaInicialUsuario', () => {
  it('admin abre no dashboard (inicio)', () => {
    expect(telaInicialUsuario({ is_admin: true })).toBe('inicio');
  });

  it('usuário só com boletos abre em boletos', () => {
    expect(telaInicialUsuario({ is_admin: false, modulo_boletos: true })).toBe('boletos');
  });
});
