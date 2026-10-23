// O axios é ESM e o Jest do CRA não o transforma; o único recurso usado é isAxiosError.
jest.mock('axios', () => ({
  __esModule: true,
  default: {
    isAxiosError: (e: unknown): boolean =>
      typeof e === 'object' && e !== null && (e as { isAxiosError?: boolean }).isAxiosError === true
  }
}));

import { mensagemErro } from './erros';
import type { ErroApi } from './erros';

function erroAxios(data: ErroApi | undefined): { isAxiosError: true; response: { data: ErroApi | undefined } } {
  return { isAxiosError: true, response: { data } };
}

describe('mensagemErro', () => {
  it('devolve o campo error da resposta da API', () => {
    expect(mensagemErro(erroAxios({ error: 'Valor inválido' }), 'padrão')).toBe('Valor inválido');
  });

  it('usa o fallback quando a resposta não traz error', () => {
    expect(mensagemErro(erroAxios({}), 'padrão')).toBe('padrão');
    expect(mensagemErro(erroAxios({ error: '' }), 'padrão')).toBe('padrão');
    expect(mensagemErro(erroAxios(undefined), 'padrão')).toBe('padrão');
  });

  it('usa o fallback quando não há resposta (erro de rede)', () => {
    expect(mensagemErro({ isAxiosError: true }, 'padrão')).toBe('padrão');
  });

  it('usa o fallback para erros que não são do axios', () => {
    expect(mensagemErro(new Error('x'), 'padrão')).toBe('padrão');
    expect(mensagemErro('texto', 'padrão')).toBe('padrão');
    expect(mensagemErro(null, 'padrão')).toBe('padrão');
  });
});
