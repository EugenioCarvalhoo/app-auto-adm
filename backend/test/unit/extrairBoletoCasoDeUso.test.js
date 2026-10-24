/**
 * Caso de uso ExtrairBoleto com portas falsas. Confere a ORDEM das validações (cada etapa registra
 * no `log`) e que uma falha de acesso nunca chega ao extrator nem ao limite diário.
 */
const { ExtrairBoletoUseCase } = require('../../src/boletos/application/extrair-boleto.caso-de-uso');
const { ErroExtratorIndisponivel } = require('../../src/boletos/application/extracao.portas');
const { ControleAcesso } = require('../../src/acesso/application/controle-acesso');
const { hojeBrasil } = require('../../src/boletos/domain/boleto');
const { EXTRACAO_VAZIA } = require('../../src/boletos/domain/extracao');

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);
const TEXTO = Buffer.from('nao sou imagem, sou um texto com nome de foto.jpg');
const BRUTO = JSON.stringify({
  tipo_documento: 'boleto',
  fornecedor: 'Hortifruti Sol',
  valor: 150.75,
  dt_vencimento: '2026-11-05',
  dt_documento: '2026-10-20',
  linha_digitavel: null
});

const GERENTE = { id: 2, is_admin: false, modulo_boletos: true };
const SEM_MODULO = { id: 4, is_admin: false, modulo_boletos: false };
const ADMIN = { id: 1, is_admin: true, modulo_boletos: true };

/** Monta o caso de uso com portas falsas. `log` guarda a ordem das etapas que foram executadas. */
function montar(opcoes = {}) {
  const {
    flags = GERENTE,
    vinculos = [1],
    disponivel = true,
    reservar = true,
    limiteDiario = 30,
    extrair = async () => BRUTO,
    devolver = async () => undefined
  } = opcoes;
  const log = [];
  const repo = {
    carregarFlags: async () => {
      log.push('acesso');
      return flags;
    },
    restauranteIdsDoUsuario: async () => vinculos,
    usuarioPodeRestaurante: async (_u, rid) => vinculos.includes(rid)
  };
  const extrator = {
    disponivel: jest.fn(() => {
      log.push('disponivel');
      return disponivel;
    }),
    extrair: jest.fn(async (...args) => {
      log.push('extrair');
      return extrair(...args);
    })
  };
  const limite = {
    reservar: jest.fn(async () => {
      log.push('reservar');
      return reservar;
    }),
    devolver: jest.fn(async () => {
      log.push('devolver');
      return devolver();
    })
  };
  const uc = new ExtrairBoletoUseCase(extrator, limite, { limiteDiario }, new ControleAcesso(repo));
  return { uc, extrator, limite, log };
}

describe('ExtrairBoleto (portas falsas)', () => {
  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  describe('ordem das validações', () => {
    it('sucesso: acesso -> disponibilidade -> reserva -> extração (nessa ordem)', async () => {
      const { uc, log } = montar();
      await uc.executar(2, 1, JPEG);
      expect(log).toEqual(['acesso', 'disponivel', 'reservar', 'extrair']);
    });

    it('restaurante_id ausente: 400 antes de qualquer acesso', async () => {
      const { uc, log, extrator, limite } = montar();
      await expect(uc.executar(2, undefined, JPEG)).rejects.toMatchObject({
        codigo: 'VALIDACAO',
        message: 'restaurante_id é obrigatório'
      });
      expect(log).toEqual([]);
      expect(extrator.extrair).not.toHaveBeenCalled();
      expect(limite.reservar).not.toHaveBeenCalled();
    });

    it('sem acesso ao restaurante: 403 e NÃO chama extrator nem limite', async () => {
      const { uc, log, extrator, limite } = montar({ vinculos: [1] });
      await expect(uc.executar(2, 2, JPEG)).rejects.toMatchObject({ codigo: 'PROIBIDO' });
      expect(log).toEqual(['acesso']);
      expect(extrator.disponivel).not.toHaveBeenCalled();
      expect(extrator.extrair).not.toHaveBeenCalled();
      expect(limite.reservar).not.toHaveBeenCalled();
      expect(limite.devolver).not.toHaveBeenCalled();
    });

    it('sem o módulo de boletos: 403 com a mensagem do módulo, sem extrator nem limite', async () => {
      const { uc, extrator, limite } = montar({ flags: SEM_MODULO, vinculos: [1] });
      await expect(uc.executar(4, 1, JPEG)).rejects.toMatchObject({
        codigo: 'PROIBIDO',
        message: 'Sem permissão para o módulo de boletos e notas.'
      });
      expect(extrator.extrair).not.toHaveBeenCalled();
      expect(limite.reservar).not.toHaveBeenCalled();
    });

    it('admin passa mesmo sem vínculo com o restaurante', async () => {
      const { uc, extrator } = montar({ flags: ADMIN, vinculos: [] });
      await expect(uc.executar(1, 99, JPEG)).resolves.toMatchObject({ tipo_documento: 'boleto' });
      expect(extrator.extrair).toHaveBeenCalledTimes(1);
    });

    it('imagem ausente ou vazia: 400 depois do acesso e antes do extrator/limite', async () => {
      for (const img of [undefined, Buffer.alloc(0)]) {
        const { uc, log, extrator, limite } = montar();
        await expect(uc.executar(2, 1, img)).rejects.toMatchObject({ codigo: 'VALIDACAO' });
        expect(log).toEqual(['acesso']);
        expect(extrator.extrair).not.toHaveBeenCalled();
        expect(limite.reservar).not.toHaveBeenCalled();
      }
    });

    it('conteúdo que não é JPEG/PNG/WebP: 415 sem consumir limite', async () => {
      const { uc, log, limite, extrator } = montar();
      await expect(uc.executar(2, 1, TEXTO)).rejects.toMatchObject({ codigo: 'TIPO_NAO_SUPORTADO' });
      expect(log).toEqual(['acesso']);
      expect(limite.reservar).not.toHaveBeenCalled();
      expect(extrator.extrair).not.toHaveBeenCalled();
    });

    it('sem chave configurada: 503 antes do limite (não consome leitura)', async () => {
      const { uc, log, limite, extrator } = montar({ disponivel: false });
      await expect(uc.executar(2, 1, JPEG)).rejects.toMatchObject({ codigo: 'INDISPONIVEL', message: 'Leitura por IA não configurada' });
      expect(log).toEqual(['acesso', 'disponivel']);
      expect(limite.reservar).not.toHaveBeenCalled();
      expect(extrator.extrair).not.toHaveBeenCalled();
    });

    it('limite diário 0: 429 sem nem perguntar ao repositório', async () => {
      const { uc, limite, extrator } = montar({ limiteDiario: 0 });
      await expect(uc.executar(2, 1, JPEG)).rejects.toMatchObject({
        codigo: 'LIMITE_EXCEDIDO',
        message: 'Limite diário de leituras por IA atingido'
      });
      expect(limite.reservar).not.toHaveBeenCalled();
      expect(extrator.extrair).not.toHaveBeenCalled();
    });

    it('limite atingido (reservar false): 429 e extrator não é chamado', async () => {
      const { uc, extrator, limite } = montar({ reservar: false });
      await expect(uc.executar(2, 1, JPEG)).rejects.toMatchObject({ codigo: 'LIMITE_EXCEDIDO' });
      expect(limite.reservar).toHaveBeenCalledWith(2, hojeBrasil(), 30);
      expect(extrator.extrair).not.toHaveBeenCalled();
      expect(limite.devolver).not.toHaveBeenCalled();
    });
  });

  describe('sucesso e saneamento', () => {
    it('devolve a sugestão saneada e passa o MIME detectado pelo conteúdo', async () => {
      const { uc, extrator } = montar();
      const r = await uc.executar(2, '1', PNG);
      expect(r).toEqual({
        tipo_documento: 'boleto',
        tipo_sugerido: 'Boleto',
        fornecedor: 'Hortifruti Sol',
        valor: 150.75,
        dt_vencimento: '2026-11-05',
        dt_documento: '2026-10-20',
        linha_digitavel: null
      });
      expect(extrator.extrair).toHaveBeenCalledWith(PNG, 'image/png');
    });

    it('aceita o objeto já interpretado (extrator que não devolve texto)', async () => {
      const { uc } = montar({ extrair: async () => ({ tipo_documento: 'nota', valor: '10,00' }) });
      await expect(uc.executar(2, 1, JPEG)).resolves.toMatchObject({ tipo_documento: 'nota', tipo_sugerido: 'Sem Boleto', valor: 10 });
    });

    it('resposta bruta ilegível (texto que não é JSON) vira tudo null, sem erro e sem devolver reserva', async () => {
      const { uc, limite } = montar({ extrair: async () => 'isto não é json' });
      await expect(uc.executar(2, 1, JPEG)).resolves.toEqual(EXTRACAO_VAZIA);
      expect(limite.devolver).not.toHaveBeenCalled();
    });

    it('usa a data de São Paulo (hojeBrasil) na reserva', async () => {
      const { uc, limite } = montar();
      await uc.executar(2, 1, JPEG);
      expect(limite.reservar).toHaveBeenCalledWith(2, hojeBrasil(), 30);
    });

    it('o dia da reserva segue o fuso de São Paulo: 02:30 UTC de 23/10 conta como 22/10', async () => {
      jest.useFakeTimers({ toFake: ['Date'] });
      jest.setSystemTime(new Date('2026-10-23T02:30:00Z'));
      try {
        const { uc, limite } = montar();
        await uc.executar(2, 1, JPEG);
        expect(limite.reservar).toHaveBeenCalledWith(2, '2026-10-22', 30);
      } finally {
        jest.useRealTimers();
      }
    });
  });

  describe('falha do provedor', () => {
    it('falha do extrator: 502 com mensagem genérica e devolve a reserva ao mesmo usuário e dia', async () => {
      const { uc, limite } = montar({
        extrair: async () => {
          throw new ErroExtratorIndisponivel();
        }
      });
      await expect(uc.executar(2, 1, JPEG)).rejects.toMatchObject({
        codigo: 'PROVEDOR_INDISPONIVEL',
        message: 'Não foi possível ler a imagem agora. Tente novamente.'
      });
      expect(limite.devolver).toHaveBeenCalledWith(2, hojeBrasil());
    });

    it('não vaza a mensagem do provedor (chave/trecho da requisição) para o cliente nem para o log', async () => {
      const { uc } = montar({
        extrair: async () => {
          throw new Error('API key AIza-SEGREDO inválida no corpo {"contents":"..."}');
        }
      });
      const erro = await uc.executar(2, 1, JPEG).catch((e) => e);
      expect(erro.message).not.toContain('SEGREDO');
      expect(JSON.stringify(erro)).not.toContain('SEGREDO');
      const logado = JSON.stringify(console.error.mock.calls);
      expect(logado).not.toContain('SEGREDO');
      expect(logado).toContain('inesperado');
    });

    it('erro do próprio extrator é logado como "provedor"', async () => {
      const { uc } = montar({
        extrair: async () => {
          throw new ErroExtratorIndisponivel();
        }
      });
      await uc.executar(2, 1, JPEG).catch(() => undefined);
      expect(JSON.stringify(console.error.mock.calls)).toContain('provedor');
    });

    it('se devolver a reserva também falhar, a resposta continua 502 (a falha é só logada)', async () => {
      const { uc } = montar({
        extrair: async () => {
          throw new ErroExtratorIndisponivel();
        },
        devolver: async () => {
          throw new Error('banco caiu');
        }
      });
      await expect(uc.executar(2, 1, JPEG)).rejects.toMatchObject({ codigo: 'PROVEDOR_INDISPONIVEL' });
      expect(JSON.stringify(console.error.mock.calls)).toContain('Falha ao devolver a reserva');
    });
  });
});
