const { codigoErro, mensagemErro, stackErro } = require('../src/shared/domain/erros');

describe('codigoErro', () => {
  it('retorna o code string do erro (ex.: SQLSTATE do pg)', () => {
    expect(codigoErro(Object.assign(new Error('x'), { code: '23505' }))).toBe('23505');
  });
  it('retorna undefined para erro sem code', () => {
    expect(codigoErro(new Error('x'))).toBeUndefined();
    expect(codigoErro({})).toBeUndefined();
  });
  it('retorna undefined quando code não é string', () => {
    expect(codigoErro({ code: 23505 })).toBeUndefined();
    expect(codigoErro({ code: null })).toBeUndefined();
  });
  it('retorna undefined para valores não-objeto', () => {
    expect(codigoErro('23505')).toBeUndefined();
    expect(codigoErro(42)).toBeUndefined();
    expect(codigoErro(null)).toBeUndefined();
    expect(codigoErro(undefined)).toBeUndefined();
  });
});

describe('mensagemErro', () => {
  it('usa message de Error', () => {
    expect(mensagemErro(new Error('falhou'))).toBe('falhou');
    expect(mensagemErro(new TypeError('tipo'))).toBe('tipo');
  });
  it('converte não-Error com String()', () => {
    expect(mensagemErro('texto')).toBe('texto');
    expect(mensagemErro(null)).toBe('null');
    expect(mensagemErro(undefined)).toBe('undefined');
    expect(mensagemErro({ a: 1 })).toBe('[object Object]');
  });
});

describe('stackErro', () => {
  it('retorna a stack de Error', () => {
    const e = new Error('x');
    expect(stackErro(e)).toBe(e.stack);
    expect(stackErro(e)).toContain('Error: x');
  });
  it('retorna undefined para não-Error', () => {
    expect(stackErro('texto')).toBeUndefined();
    expect(stackErro(null)).toBeUndefined();
    expect(stackErro({ stack: 'fake' })).toBeUndefined();
  });
});
