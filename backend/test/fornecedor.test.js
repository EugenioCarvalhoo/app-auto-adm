/** Normalização e saneamento do nome do fornecedor. Funções puras. */
const { normalizarFornecedor, sanearFornecedor, FORNECEDOR_MAX } = require('../lib/fornecedor');

describe('fornecedor', () => {
  describe('normalizarFornecedor', () => {
    it('minúsculas, sem acento e espaços colapsados', () => {
      expect(normalizarFornecedor('  AÇOUGUE   São  João ')).toBe('acougue sao joao');
    });
    it('variações do mesmo nome ficam iguais', () => {
      expect(normalizarFornecedor('Distribuidora Pão & Cia')).toBe(normalizarFornecedor('distribuidora   PAO & cia'));
    });
    it('null, undefined e vazio => string vazia', () => {
      expect(normalizarFornecedor(null)).toBe('');
      expect(normalizarFornecedor(undefined)).toBe('');
      expect(normalizarFornecedor('   ')).toBe('');
    });
    it('quebras de linha e tabs viram um espaço', () => {
      expect(normalizarFornecedor('a\n\tb')).toBe('a b');
    });
  });

  describe('sanearFornecedor', () => {
    it('remove caracteres de controle e colapsa espaços', () => {
      expect(sanearFornecedor('  Loja\u0000\u0007 X\n\nY  ')).toBe('Loja X Y');
    });
    it('mantém acentos e capitalização', () => {
      expect(sanearFornecedor('Açougue Ômega')).toBe('Açougue Ômega');
    });
    it('vazio ou só controle => null', () => {
      expect(sanearFornecedor('')).toBeNull();
      expect(sanearFornecedor('   \u0001  ')).toBeNull();
      expect(sanearFornecedor(null)).toBeNull();
      expect(sanearFornecedor(undefined)).toBeNull();
    });
    it('limita ao tamanho máximo', () => {
      expect(sanearFornecedor('a'.repeat(FORNECEDOR_MAX + 50))).toHaveLength(FORNECEDOR_MAX);
    });
    it('não interpreta HTML (devolve texto cru; o escape é do front)', () => {
      expect(sanearFornecedor('<b>x</b>')).toBe('<b>x</b>');
    });
  });
});
