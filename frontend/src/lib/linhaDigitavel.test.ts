import { formatarLinhaDigitavel, somenteDigitos } from './linhaDigitavel';

describe('linhaDigitavel', () => {
  it('remove tudo que não é dígito', () => {
    expect(somenteDigitos('12345.678 90-ab')).toBe('1234567890');
  });

  it('formata 47 dígitos em blocos', () => {
    const d = '34191790010104351004791020150008291070026000';
    const completo = `${d}123`;
    expect(completo).toHaveLength(47);
    expect(formatarLinhaDigitavel(completo)).toBe(
      '34191.79001 01043.510047 91020.150008 2 91070026000123'
    );
  });

  it('formata 48 dígitos em 4 blocos de 12', () => {
    const d = '8'.repeat(48);
    expect(formatarLinhaDigitavel(d).split(' ')).toHaveLength(4);
  });

  it('parcial: blocos de 5', () => {
    expect(formatarLinhaDigitavel('1234567')).toBe('12345 67');
  });
});
