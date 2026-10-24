const { ControleAcesso } = require('../../src/acesso/application/controle-acesso');
const { LoginUseCase } = require('../../src/auth/application/casos-de-uso');
const {
  CriarBoletoUseCase,
  AtualizarBoletoUseCase,
  ExcluirBoletoUseCase
} = require('../../src/boletos/application/boletos.casos-de-uso');

const admin = { id: 1, is_admin: true, modulo_boletos: true };
const gerenteA = { id: 2, is_admin: false, modulo_boletos: true };
const semModulo = { id: 3, is_admin: false, modulo_boletos: false };

function acessoFalso() {
  const flags = { 1: admin, 2: gerenteA, 3: semModulo };
  const vinculos = { 2: [1], 3: [1] };
  return new ControleAcesso({
    carregarFlags: async (id) => flags[id] ?? null,
    restauranteIdsDoUsuario: async (id) => vinculos[id] ?? [],
    usuarioPodeRestaurante: async (id, rid) => (vinculos[id] ?? []).includes(rid)
  });
}

describe('LoginUseCase (portas falsas)', () => {
  let logSpy;
  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => logSpy.mockRestore());

  function criar({ usuario = { id: 2, username: 'g', nome: 'G', password: 'hash' }, senhaOk = true } = {}) {
    const usuarios = { buscarPorUsername: jest.fn(async () => usuario), buscarPorId: jest.fn() };
    const hasher = { comparar: jest.fn(async () => senhaOk), gerar: jest.fn() };
    const tokens = { assinar: jest.fn(() => 'tok'), verificar: jest.fn() };
    return { usuarios, hasher, tokens, uc: new LoginUseCase(usuarios, hasher, tokens, acessoFalso()) };
  }

  it('exige username e senha sem consultar repositório', async () => {
    const { uc, usuarios } = criar();
    await expect(uc.executar('', 'x')).rejects.toMatchObject({ codigo: 'VALIDACAO' });
    await expect(uc.executar('g', '')).rejects.toMatchObject({ codigo: 'VALIDACAO' });
    expect(usuarios.buscarPorUsername).not.toHaveBeenCalled();
  });

  it('usuário inexistente e senha errada dão a MESMA mensagem (sem enumeração)', async () => {
    const a = criar({ usuario: null });
    const b = criar({ senhaOk: false });
    const ea = await a.uc.executar('x', 'y').catch((e) => e);
    const eb = await b.uc.executar('g', 'y').catch((e) => e);
    expect(ea).toMatchObject({ codigo: 'NAO_AUTENTICADO', message: 'Credenciais inválidas' });
    expect(eb).toMatchObject({ codigo: 'NAO_AUTENTICADO' });
    expect(eb.message).toBe(ea.message);
    expect(b.tokens.assinar).not.toHaveBeenCalled();
  });

  it('sucesso: assina token 24h com flags do banco e não vaza a senha', async () => {
    const { uc, tokens } = criar();
    const r = await uc.executar('g', 'senha123');
    expect(r.token).toBe('tok');
    expect(r.user).toEqual({ id: 2, username: 'g', nome: 'G', is_admin: false, modulo_boletos: true, restaurante_ids: [1] });
    expect(JSON.stringify(r)).not.toContain('hash');
    expect(tokens.assinar).toHaveBeenCalledWith({ id: 2, username: 'g', is_admin: false, modulo_boletos: true }, '24h');
  });

  it('perfil não carregável (flags ausentes) => INTERNO', async () => {
    const { uc } = criar({ usuario: { id: 99, username: 'f', nome: 'F', password: 'h' } });
    await expect(uc.executar('f', 'x')).rejects.toMatchObject({ codigo: 'INTERNO' });
  });
});

describe('Boletos: casos de uso com repositório falso', () => {
  const criadoEm = new Date();
  function linha(over = {}) {
    return {
      id: 10,
      restaurante_id: 2,
      usuario_id: 1,
      dt_recebimento: '2026-10-20',
      dt_vencimento: '2026-10-24',
      descricao: 'original',
      valor: '10.00',
      tipo: 'Boleto',
      created_at: criadoEm,
      updated_at: criadoEm,
      ...over
    };
  }
  function repoFalso(registro) {
    return {
      inserir: jest.fn(async (n) =>
        linha({
          id: 99,
          restaurante_id: n.restauranteId,
          usuario_id: n.usuarioId,
          dt_recebimento: n.dtRecebimento,
          dt_vencimento: n.dtVencimento,
          descricao: n.descricao,
          valor: String(n.valor),
          tipo: n.tipo
        })
      ),
      buscarPorId: jest.fn(async () => registro),
      atualizar: jest.fn(async (id, a) =>
        linha({
          id,
          dt_recebimento: a.dtRecebimento,
          dt_vencimento: a.dtVencimento,
          descricao: a.descricao,
          valor: String(a.valor),
          tipo: a.tipo
        })
      ),
      buscarParaExclusao: jest.fn(async () =>
        registro ? { restaurante_id: registro.restaurante_id, created_at: registro.created_at } : null
      ),
      excluir: jest.fn(async () => {})
    };
  }
  const corpoValido = {
    restaurante_id: 1,
    descricao: ' Fornecedor ',
    valor: '1.234,50',
    tipo: 'Boleto',
    dt_recebimento: '2026-10-20',
    dt_vencimento: '2026-10-24'
  };

  describe('CriarBoletoUseCase', () => {
    it('cria com valores normalizados e usuário vindo do token (não do corpo)', async () => {
      const repo = repoFalso(null);
      const r = await new CriarBoletoUseCase(repo, acessoFalso()).executar(2, { ...corpoValido, usuario_id: 1 });
      expect(repo.inserir).toHaveBeenCalledWith({
        restauranteId: 1,
        usuarioId: 2,
        dtRecebimento: '2026-10-20',
        dtVencimento: '2026-10-24',
        descricao: 'Fornecedor',
        valor: 1234.5,
        tipo: 'Boleto'
      });
      expect(r.valor).toBe(1234.5);
    });

    it('IDOR: gerente do restaurante 1 não cria no 2 (nada gravado)', async () => {
      const repo = repoFalso(null);
      await expect(
        new CriarBoletoUseCase(repo, acessoFalso()).executar(2, { ...corpoValido, restaurante_id: 2 })
      ).rejects.toMatchObject({ codigo: 'PROIBIDO' });
      expect(repo.inserir).not.toHaveBeenCalled();
    });

    it('sem módulo é barrado; admin cria em qualquer restaurante', async () => {
      const repo = repoFalso(null);
      const uc = new CriarBoletoUseCase(repo, acessoFalso());
      await expect(uc.executar(3, corpoValido)).rejects.toMatchObject({ codigo: 'PROIBIDO' });
      await uc.executar(1, { ...corpoValido, restaurante_id: 2 });
      expect(repo.inserir).toHaveBeenCalledTimes(1);
    });

    it.each([
      ['restaurante_id ausente', { restaurante_id: undefined }],
      ['descrição vazia', { descricao: '   ' }],
      ['valor inválido', { valor: 'abc' }],
      ['valor acima do limite', { valor: 1e15 }],
      ['recebimento impossível', { dt_recebimento: '2026-02-31' }],
      ['boleto sem vencimento', { dt_vencimento: undefined }],
      ['vencimento impossível', { dt_vencimento: '2026-13-01' }]
    ])('rejeita %s com VALIDACAO sem gravar', async (_nome, over) => {
      const repo = repoFalso(null);
      await expect(
        new CriarBoletoUseCase(repo, acessoFalso()).executar(1, { ...corpoValido, ...over })
      ).rejects.toMatchObject({ codigo: 'VALIDACAO' });
      expect(repo.inserir).not.toHaveBeenCalled();
    });

    it('Sem Boleto: dispensa vencimento e usa hoje quando sem recebimento', async () => {
      const repo = repoFalso(null);
      await new CriarBoletoUseCase(repo, acessoFalso()).executar(1, {
        restaurante_id: 1,
        descricao: 'n',
        valor: 5,
        tipo: 'Sem Boleto'
      });
      const arg = repo.inserir.mock.calls[0][0];
      expect(arg.dtVencimento).toBeNull();
      expect(arg.dtRecebimento).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });

  describe('AtualizarBoletoUseCase', () => {
    it('IDOR: valida o restaurante do REGISTRO, ignorando restaurante_id do corpo', async () => {
      const repo = repoFalso(linha({ restaurante_id: 2 }));
      const uc = new AtualizarBoletoUseCase(repo, acessoFalso());
      await expect(uc.executar(2, '10', { restaurante_id: 1, descricao: 'hack' })).rejects.toMatchObject({
        codigo: 'PROIBIDO'
      });
      expect(repo.atualizar).not.toHaveBeenCalled();
    });

    it('id inválido => VALIDACAO; inexistente => NAO_ENCONTRADO', async () => {
      const uc = new AtualizarBoletoUseCase(repoFalso(null), acessoFalso());
      await expect(uc.executar(1, 'abc', {})).rejects.toMatchObject({ codigo: 'VALIDACAO' });
      await expect(uc.executar(1, '10', {})).rejects.toMatchObject({ codigo: 'NAO_ENCONTRADO' });
    });

    it('atualização parcial preserva os campos não enviados', async () => {
      const repo = repoFalso(linha({ restaurante_id: 1 }));
      await new AtualizarBoletoUseCase(repo, acessoFalso()).executar(2, '10', { descricao: 'nova' });
      expect(repo.atualizar).toHaveBeenCalledWith(10, {
        dtRecebimento: '2026-10-20',
        dtVencimento: '2026-10-24',
        descricao: 'nova',
        valor: 10,
        tipo: 'Boleto'
      });
    });

    it('trocar para Sem Boleto zera o vencimento; voltar a Boleto sem vencimento falha', async () => {
      const repo = repoFalso(linha({ restaurante_id: 1 }));
      await new AtualizarBoletoUseCase(repo, acessoFalso()).executar(2, '10', { tipo: 'Sem Boleto' });
      expect(repo.atualizar.mock.calls[0][1].dtVencimento).toBeNull();
      const repo2 = repoFalso(linha({ restaurante_id: 1, tipo: 'Sem Boleto', dt_vencimento: null }));
      await expect(
        new AtualizarBoletoUseCase(repo2, acessoFalso()).executar(2, '10', { tipo: 'Boleto' })
      ).rejects.toMatchObject({ codigo: 'VALIDACAO' });
      expect(repo2.atualizar).not.toHaveBeenCalled();
    });

    it('valores inválidos no corpo => VALIDACAO', async () => {
      const repo = repoFalso(linha({ restaurante_id: 1 }));
      const uc = new AtualizarBoletoUseCase(repo, acessoFalso());
      await expect(uc.executar(2, '10', { valor: -5 })).rejects.toMatchObject({ codigo: 'VALIDACAO' });
      await expect(uc.executar(2, '10', { descricao: '  ' })).rejects.toMatchObject({ codigo: 'VALIDACAO' });
      await expect(uc.executar(2, '10', { dt_recebimento: '2026-02-30' })).rejects.toMatchObject({ codigo: 'VALIDACAO' });
      expect(repo.atualizar).not.toHaveBeenCalled();
    });
  });

  describe('ExcluirBoletoUseCase', () => {
    it('IDOR: não exclui registro de outro restaurante', async () => {
      const repo = repoFalso(linha({ restaurante_id: 2 }));
      await expect(new ExcluirBoletoUseCase(repo, acessoFalso()).executar(2, '10')).rejects.toMatchObject({
        codigo: 'PROIBIDO'
      });
      expect(repo.excluir).not.toHaveBeenCalled();
    });

    it('gerente exclui lançamento recente; com mais de 1 dia só o admin', async () => {
      const velho = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
      const repo = repoFalso(linha({ restaurante_id: 1, created_at: velho }));
      const uc = new ExcluirBoletoUseCase(repo, acessoFalso());
      await expect(uc.executar(2, '10')).rejects.toMatchObject({ codigo: 'PROIBIDO' });
      expect(repo.excluir).not.toHaveBeenCalled();
      await expect(uc.executar(1, '10')).resolves.toEqual({ message: 'Lançamento removido', id: 10 });
      const repo2 = repoFalso(linha({ restaurante_id: 1 }));
      await new ExcluirBoletoUseCase(repo2, acessoFalso()).executar(2, '10');
      expect(repo2.excluir).toHaveBeenCalledWith(10);
    });

    it('inexistente => NAO_ENCONTRADO', async () => {
      await expect(new ExcluirBoletoUseCase(repoFalso(null), acessoFalso()).executar(1, '10')).rejects.toMatchObject({
        codigo: 'NAO_ENCONTRADO'
      });
    });
  });
});
