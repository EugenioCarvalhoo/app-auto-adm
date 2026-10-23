/** Linha digitável: normalização, validação (47/48 dígitos, DVs) e formatação. Funções puras. */
const {
  normalizarLinhaDigitavel,
  validarLinhaDigitavel,
  formatarLinhaDigitavel,
  dvModulo10
} = require('../lib/linhaDigitavel');
const { linha47, linha48, corromper, corromperCampo1 } = require('./helpers/linhas');

const EXEMPLO_MASCARA = '00190.50095 40144.816069 06809.350314 3 37370000000100';
const EXEMPLO_DIGITOS = '00190500954014481606906809350314337370000000100';

describe('linhaDigitavel', () => {
  describe('normalizarLinhaDigitavel', () => {
    it('remove pontos, espaços e hífens', () => {
      expect(normalizarLinhaDigitavel('12345.67890 11111-2')).toBe('1234567890111112');
    });
    it('null e undefined viram string vazia', () => {
      expect(normalizarLinhaDigitavel(null)).toBe('');
      expect(normalizarLinhaDigitavel(undefined)).toBe('');
    });
  });

  describe('dvModulo10', () => {
    it('calcula os DVs do exemplo clássico', () => {
      expect(dvModulo10('001905009')).toBe(5);
      expect(dvModulo10('4014481606')).toBe(9);
      expect(dvModulo10('0680935031')).toBe(4);
    });
  });

  describe('47 dígitos (boleto bancário)', () => {
    it('aceita o exemplo clássico com máscara', () => {
      expect(validarLinhaDigitavel(EXEMPLO_MASCARA)).toEqual({ valida: true, linha: EXEMPLO_DIGITOS });
    });

    it.each([1, 2, 3, 50])('aceita linha gerada válida (seed %i)', (seed) => {
      const l = linha47(seed);
      expect(l).toHaveLength(47);
      expect(validarLinhaDigitavel(l)).toEqual({ valida: true, linha: l });
    });

    it('DV geral errado => dv', () => {
      const l = linha47(2);
      const errado = l.slice(0, 32) + String((Number(l[32]) + 1) % 10) + l.slice(33);
      expect(validarLinhaDigitavel(errado)).toMatchObject({ valida: false, motivo: 'dv' });
    });

    it('DV de campo errado => dv', () => {
      expect(validarLinhaDigitavel(corromperCampo1(linha47(2)))).toMatchObject({ valida: false, motivo: 'dv' });
    });

    it('alterar o valor (sem refazer o DV geral) => dv', () => {
      expect(validarLinhaDigitavel(corromper(linha47(3)))).toMatchObject({ valida: false, motivo: 'dv' });
    });
  });

  describe('48 dígitos (arrecadação)', () => {
    it.each([
      [1, 10],
      [2, 10],
      [1, 11],
      [9, 11]
    ])('aceita linha gerada válida (seed %i, módulo %i)', (seed, modulo) => {
      const l = linha48(seed, modulo);
      expect(l).toHaveLength(48);
      expect(validarLinhaDigitavel(l)).toEqual({ valida: true, linha: l });
    });

    it('aceita com espaços entre os blocos', () => {
      const l = linha48(4, 10);
      const comEspacos = [0, 12, 24, 36].map((i) => l.slice(i, i + 12)).join(' ');
      expect(validarLinhaDigitavel(comEspacos)).toEqual({ valida: true, linha: l });
    });

    it('DV de bloco errado => dv', () => {
      expect(validarLinhaDigitavel(corromper(linha48(1, 10)))).toMatchObject({ valida: false, motivo: 'dv' });
      expect(validarLinhaDigitavel(corromper(linha48(1, 11)))).toMatchObject({ valida: false, motivo: 'dv' });
    });

    it('não começando por 8 => dv', () => {
      const l = linha48(1, 10);
      expect(validarLinhaDigitavel('7' + l.slice(1))).toMatchObject({ valida: false, motivo: 'dv' });
    });

    it('identificador de módulo desconhecido (3º dígito) => dv', () => {
      const l = linha48(1, 10);
      expect(validarLinhaDigitavel(l.slice(0, 2) + '5' + l.slice(3))).toMatchObject({ valida: false, motivo: 'dv' });
    });
  });

  describe('entradas inválidas', () => {
    it.each([null, undefined, '', '   ', 'abc'])('vazia (%p)', (v) => {
      expect(validarLinhaDigitavel(v)).toMatchObject({ valida: false, motivo: 'vazia' });
    });
    it.each([1, 46, 49, 50])('tamanho %i => tamanho', (n) => {
      expect(validarLinhaDigitavel('1'.repeat(n))).toMatchObject({ valida: false, motivo: 'tamanho', linha: '1'.repeat(n) });
    });
    it('linha válida sem o último dígito => tamanho', () => {
      expect(validarLinhaDigitavel(linha47(1).slice(0, 46))).toMatchObject({ valida: false, motivo: 'tamanho' });
    });
  });

  describe('formatarLinhaDigitavel', () => {
    it('47 dígitos: 5.5 5.6 5.6 1 14', () => {
      expect(formatarLinhaDigitavel(EXEMPLO_DIGITOS)).toBe(EXEMPLO_MASCARA);
    });
    it('48 dígitos: 4 blocos de 12', () => {
      const l = linha48(1, 10);
      expect(formatarLinhaDigitavel(l).split(' ')).toEqual([0, 12, 24, 36].map((i) => l.slice(i, i + 12)));
    });
    it('é idempotente (formatar o já formatado)', () => {
      const f = formatarLinhaDigitavel(linha47(5));
      expect(formatarLinhaDigitavel(f)).toBe(f);
    });
    it('outro tamanho volta só com dígitos', () => {
      expect(formatarLinhaDigitavel('12.34-5')).toBe('12345');
      expect(formatarLinhaDigitavel(null)).toBe('');
    });
  });
});
