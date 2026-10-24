/**
 * Leitura de EXTRAIR_LIMITE_DIARIO, IMAGEM_MAX_MB e GEMINI_* do ambiente. Valor inválido volta ao padrão.
 */
const { limiteDiarioDoAmbiente } = require('../../src/boletos/boletos.module');
const { imagemMaxBytes, IMAGEM_MAX_MB_PADRAO } = require('../../src/boletos/presentation/imagem-upload.interceptor');
const { GEMINI_MODEL_PADRAO, GEMINI_TIMEOUT_PADRAO_MS } = require('../../src/boletos/infrastructure/gemini-extrator');

const VARS = ['EXTRAIR_LIMITE_DIARIO', 'IMAGEM_MAX_MB'];

describe('configuração da leitura por IA (ambiente)', () => {
  const anterior = {};
  beforeEach(() => {
    VARS.forEach((v) => {
      anterior[v] = process.env[v];
      delete process.env[v];
    });
  });
  afterEach(() => {
    VARS.forEach((v) => {
      if (anterior[v] === undefined) delete process.env[v];
      else process.env[v] = anterior[v];
    });
  });

  describe('limiteDiarioDoAmbiente (EXTRAIR_LIMITE_DIARIO, padrão 30)', () => {
    it('sem a variável, ou vazia, usa 30', () => {
      expect(limiteDiarioDoAmbiente()).toBe(30);
      process.env.EXTRAIR_LIMITE_DIARIO = '   ';
      expect(limiteDiarioDoAmbiente()).toBe(30);
    });

    it('aceita inteiros >= 0, inclusive 0 (bloqueia todas as leituras)', () => {
      process.env.EXTRAIR_LIMITE_DIARIO = '5';
      expect(limiteDiarioDoAmbiente()).toBe(5);
      process.env.EXTRAIR_LIMITE_DIARIO = '0';
      expect(limiteDiarioDoAmbiente()).toBe(0);
    });

    it('negativo, fracionário ou não numérico volta ao padrão 30', () => {
      for (const ruim of ['-1', '2.5', 'abc', 'NaN']) {
        process.env.EXTRAIR_LIMITE_DIARIO = ruim;
        expect(limiteDiarioDoAmbiente()).toBe(30);
      }
    });
  });

  describe('imagemMaxBytes (IMAGEM_MAX_MB, padrão 5)', () => {
    it('sem a variável usa 5 MB', () => {
      expect(IMAGEM_MAX_MB_PADRAO).toBe(5);
      expect(imagemMaxBytes()).toBe(5 * 1024 * 1024);
    });

    it('lê o valor configurado a cada chamada', () => {
      process.env.IMAGEM_MAX_MB = '2';
      expect(imagemMaxBytes()).toBe(2 * 1024 * 1024);
    });

    it('zero, negativo ou inválido volta ao padrão de 5 MB (nunca 0 bytes)', () => {
      for (const ruim of ['0', '-3', 'x']) {
        process.env.IMAGEM_MAX_MB = ruim;
        expect(imagemMaxBytes()).toBe(5 * 1024 * 1024);
      }
    });
  });

  describe('Gemini (padrões do adaptador)', () => {
    it('modelo padrão é o Flash e o timeout padrão é 30 s', () => {
      expect(GEMINI_MODEL_PADRAO).toBe('gemini-flash-latest');
      expect(GEMINI_TIMEOUT_PADRAO_MS).toBe(60000);
    });
  });
});
