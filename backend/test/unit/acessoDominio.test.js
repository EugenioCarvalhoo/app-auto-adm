const {
  usuarioRestaurantesRestritos,
  temAcessoModuloBoletos,
  montarFlags
} = require('../../src/acesso/domain/regras');
const { ControleAcesso, MSG_SEM_MODULO_BOLETOS } = require('../../src/acesso/application/controle-acesso');
const { normalizarRestaurante } = require('../../src/restaurantes/domain/restaurante');

describe('regras de acesso (domínio)', () => {
  it('só não-admin é restrito a restaurantes vinculados', () => {
    expect(usuarioRestaurantesRestritos({ id: 1, is_admin: true, modulo_boletos: true })).toBe(false);
    expect(usuarioRestaurantesRestritos({ id: 2, is_admin: false, modulo_boletos: true })).toBe(true);
    expect(usuarioRestaurantesRestritos(null)).toBe(false);
    expect(usuarioRestaurantesRestritos(undefined)).toBe(false);
  });

  it('admin sempre tem módulo de boletos; demais dependem da flag', () => {
    expect(temAcessoModuloBoletos({ id: 1, is_admin: true, modulo_boletos: false })).toBe(true);
    expect(temAcessoModuloBoletos({ id: 2, is_admin: false, modulo_boletos: false })).toBe(false);
    expect(temAcessoModuloBoletos({ id: 3, is_admin: false, modulo_boletos: true })).toBe(true);
  });

  it('montarFlags normaliza nulos e força modulo_boletos para admin', () => {
    expect(montarFlags({ id: 1, is_admin: true, modulo_boletos: null })).toEqual({ id: 1, is_admin: true, modulo_boletos: true });
    expect(montarFlags({ id: 2, is_admin: null, modulo_boletos: null })).toEqual({ id: 2, is_admin: false, modulo_boletos: false });
    expect(montarFlags({ id: 3, is_admin: false, modulo_boletos: true })).toEqual({ id: 3, is_admin: false, modulo_boletos: true });
  });
});

describe('ControleAcesso (repositório falso)', () => {
  function criar({ flags = {}, vinculos = {} } = {}) {
    const repo = {
      carregarFlags: jest.fn(async (id) => flags[id] ?? null),
      restauranteIdsDoUsuario: jest.fn(async (id) => vinculos[id] ?? []),
      usuarioPodeRestaurante: jest.fn(async (id, rid) => (vinculos[id] ?? []).includes(rid))
    };
    return { repo, acesso: new ControleAcesso(repo) };
  }
  const admin = { id: 1, is_admin: true, modulo_boletos: true };
  const gerente = { id: 2, is_admin: false, modulo_boletos: true };
  const semModulo = { id: 3, is_admin: false, modulo_boletos: false };

  it('exigirModuloBoletos: usuário inexistente e sem módulo => PROIBIDO', async () => {
    const { acesso } = criar({ flags: { 3: semModulo } });
    await expect(acesso.exigirModuloBoletos(99)).rejects.toMatchObject({ codigo: 'PROIBIDO', message: 'Usuário inválido.' });
    await expect(acesso.exigirModuloBoletos(3)).rejects.toMatchObject({ codigo: 'PROIBIDO', message: MSG_SEM_MODULO_BOLETOS });
  });

  it('exigirModuloBoletos: admin e gerente com módulo passam', async () => {
    const { acesso } = criar({ flags: { 1: admin, 2: gerente } });
    await expect(acesso.exigirModuloBoletos(1)).resolves.toBeUndefined();
    await expect(acesso.exigirModuloBoletos(2)).resolves.toBeUndefined();
  });

  it('exigirAcessoBoletosRestaurante: restaurante_id inválido => VALIDACAO sem consultar o banco', async () => {
    const { acesso, repo } = criar({ flags: { 2: gerente } });
    await expect(acesso.exigirAcessoBoletosRestaurante(2, 'abc')).rejects.toMatchObject({ codigo: 'VALIDACAO' });
    await expect(acesso.exigirAcessoBoletosRestaurante(2, undefined)).rejects.toMatchObject({ codigo: 'VALIDACAO' });
    expect(repo.carregarFlags).not.toHaveBeenCalled();
  });

  it('exigirAcessoBoletosRestaurante: gerente só no restaurante vinculado (isolamento)', async () => {
    const { acesso } = criar({ flags: { 2: gerente }, vinculos: { 2: [1] } });
    await expect(acesso.exigirAcessoBoletosRestaurante(2, 1)).resolves.toBeUndefined();
    await expect(acesso.exigirAcessoBoletosRestaurante(2, '1')).resolves.toBeUndefined();
    await expect(acesso.exigirAcessoBoletosRestaurante(2, 2)).rejects.toMatchObject({ codigo: 'PROIBIDO' });
  });

  it('exigirAcessoBoletosRestaurante: sem módulo é barrado mesmo com vínculo; admin dispensa vínculo', async () => {
    const { acesso, repo } = criar({ flags: { 1: admin, 3: semModulo }, vinculos: { 3: [1] } });
    await expect(acesso.exigirAcessoBoletosRestaurante(3, 1)).rejects.toMatchObject({ codigo: 'PROIBIDO', message: MSG_SEM_MODULO_BOLETOS });
    await expect(acesso.exigirAcessoBoletosRestaurante(1, 2)).resolves.toBeUndefined();
    expect(repo.usuarioPodeRestaurante).not.toHaveBeenCalled();
  });

  it('exigirAcessoBoletosRestaurante: usuário inexistente => PROIBIDO', async () => {
    const { acesso } = criar();
    await expect(acesso.exigirAcessoBoletosRestaurante(9, 1)).rejects.toMatchObject({ codigo: 'PROIBIDO' });
  });

  it('montarUsuarioCliente: admin sem restaurante_ids; gerente com vínculos; inexistente => null', async () => {
    const { acesso, repo } = criar({ flags: { 1: admin, 2: gerente }, vinculos: { 1: [1, 2], 2: [2] } });
    const a = await acesso.montarUsuarioCliente({ id: 1, username: 'admin', nome: 'Admin' });
    expect(a).toEqual({ id: 1, username: 'admin', nome: 'Admin', is_admin: true, modulo_boletos: true, restaurante_ids: [] });
    expect(repo.restauranteIdsDoUsuario).not.toHaveBeenCalledWith(1);
    const g = await acesso.montarUsuarioCliente({ id: 2, username: 'g', nome: 'G' });
    expect(g.restaurante_ids).toEqual([2]);
    expect(await acesso.montarUsuarioCliente({ id: 9, username: 'x', nome: 'X' })).toBeNull();
  });
});

describe('normalizarRestaurante', () => {
  it('nome obrigatório (vazio, só espaços ou ausente => null)', () => {
    expect(normalizarRestaurante({})).toBeNull();
    expect(normalizarRestaurante({ nome: '' })).toBeNull();
    expect(normalizarRestaurante({ nome: '   ' })).toBeNull();
  });

  it('faz trim do nome e converte campos vazios em null', () => {
    expect(normalizarRestaurante({ nome: '  Loja  ', endereco: '', telefone: undefined, email: 'a@b.c', cnpj: null })).toEqual({
      nome: 'Loja',
      endereco: null,
      telefone: null,
      email: 'a@b.c',
      cnpj: null,
      observacoes: null
    });
  });

  it('nome não-string lança (vira 500 como no Express) - comportamento legado documentado', () => {
    expect(() => normalizarRestaurante({ nome: 123 })).toThrow();
  });
});
