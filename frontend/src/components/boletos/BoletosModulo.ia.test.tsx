import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import axios from 'axios';
import BoletosModulo from './BoletosModulo';
import { reduzirImagem } from '../../lib/imagem';
import type { Boleto, SugestaoBoleto } from '../../types';

jest.mock('axios', () => {
  const ehErroAxios = (valor: unknown): boolean =>
    typeof valor === 'object' && valor !== null && (valor as { isAxiosError?: unknown }).isAxiosError === true;
  const ehCancelamento = (valor: unknown): boolean =>
    typeof valor === 'object' && valor !== null && (valor as { __CANCEL__?: unknown }).__CANCEL__ === true;
  return {
    __esModule: true,
    default: {
      get: jest.fn(),
      post: jest.fn(),
      put: jest.fn(),
      delete: jest.fn(),
      // Funções simples (não jest.fn): o CRA usa resetMocks: true e zeraria uma implementação de jest.fn.
      isAxiosError: ehErroAxios,
      isCancel: ehCancelamento,
    },
  };
});

jest.mock('../../config', () => ({ API_URL: 'http://localhost:5000' }));

// A compressão tem teste próprio (lib/imagem.test.ts). Aqui a foto segue como está.
jest.mock('../../lib/imagem', () => {
  const real = jest.requireActual<typeof import('../../lib/imagem')>('../../lib/imagem');
  return { ...real, reduzirImagem: jest.fn() };
});

type Chamada = [string, unknown, { signal?: AbortSignal } | undefined];

const axiosMock = axios as unknown as {
  get: jest.Mock;
  post: jest.Mock;
  put: jest.Mock;
  delete: jest.Mock;
};
const reduzirMock = reduzirImagem as unknown as jest.Mock;

const SUGESTAO: SugestaoBoleto = {
  tipo_documento: 'boleto',
  tipo_sugerido: 'Boleto',
  fornecedor: 'Hortifruti Sol',
  valor: 123.45,
  dt_vencimento: '2026-11-05',
  dt_documento: '2026-10-20',
  linha_digitavel: '23790.00000 60000.000000 00000.000000 1 00000000012345'
};

const BOLETO_EXISTENTE: Boleto = {
  id: 10,
  restaurante_id: 1,
  dt_recebimento: '2026-10-20',
  dt_vencimento: '2026-11-05',
  descricao: 'Fornecedor A',
  valor: 100.5,
  tipo: 'Boleto',
  dt_vencimento_efetivo: '2026-11-05',
  semana_inicio: '2026-10-17',
  semana_fim: '2026-10-23',
  semana_chave: '2026-10-17',
  created_at: null
};

let boletosNoServidor: Boleto[] = [];
let contadorUrl = 0;

function erroAxios(status: number | null, corpo?: { error: string }) {
  return Object.assign(new Error('Request failed'), {
    isAxiosError: true,
    response: status === null ? undefined : { status, data: corpo }
  });
}

function cancelamento() {
  return Object.assign(new Error('canceled'), { __CANCEL__: true });
}

/** Faz o endpoint de leitura responder com `resposta()`; os demais POSTs (salvar) respondem vazio. */
function extrairComo(resposta: () => Promise<unknown>) {
  axiosMock.post.mockImplementation((url: string) =>
    url.endsWith('/boletos/extrair') ? resposta() : Promise.resolve({ data: {} })
  );
}

function chamadasPost(sufixo: string): Chamada[] {
  return (axiosMock.post.mock.calls as Chamada[]).filter(([url]) => url.endsWith(sufixo));
}

function renderizar(restauranteId = 1) {
  return render(<BoletosModulo restauranteId={restauranteId} restauranteNome="Restaurante A" />);
}

async function montarComPainel(restauranteId = 1) {
  const resultado = renderizar(restauranteId);
  await screen.findByTestId('ia-painel');
  return resultado;
}

function escolherFoto(nome = 'boleto.jpg'): File {
  const arquivo = new File(['conteudo'], nome, { type: 'image/jpeg' });
  fireEvent.change(screen.getByTestId('ia-input-arquivo'), { target: { files: [arquivo] } });
  return arquivo;
}

function campo(nome: string): HTMLInputElement | HTMLSelectElement {
  const el = document.querySelector<HTMLInputElement | HTMLSelectElement>(`[data-boleto-campo="${nome}"]`);
  if (!el) throw new Error(`campo ${nome} ausente`);
  return el;
}

function botaoSalvar(): HTMLButtonElement {
  const el = document.querySelector<HTMLButtonElement>('[data-boleto-salvar]');
  if (!el) throw new Error('botão salvar ausente');
  return el;
}

beforeAll(() => {
  Element.prototype.scrollIntoView = jest.fn();
});

beforeEach(() => {
  boletosNoServidor = [];
  contadorUrl = 0;
  URL.createObjectURL = jest.fn(() => `blob:ia-${++contadorUrl}`);
  URL.revokeObjectURL = jest.fn();

  axiosMock.get.mockReset();
  axiosMock.get.mockImplementation((url: string) => {
    if (url.endsWith('/boletos/resumo')) return Promise.resolve({ data: { semanas: [], total_geral: 0 } });
    if (url.endsWith('/boletos/metas')) return Promise.resolve({ data: [] });
    return Promise.resolve({ data: boletosNoServidor });
  });
  axiosMock.post.mockReset();
  extrairComo(() => Promise.resolve({ data: SUGESTAO }));
  axiosMock.put.mockReset();
  axiosMock.delete.mockReset();

  reduzirMock.mockReset();
  reduzirMock.mockImplementation((arquivo: File) => Promise.resolve(arquivo));
});

describe('leitura por IA: sucesso', () => {
  it('envia a foto com o restaurante e preenche só os campos vazios, marcando com selo', async () => {
    await montarComPainel(1);

    escolherFoto();
    await screen.findByTestId('ia-selo-descricao');

    const envios = chamadasPost('/boletos/extrair');
    expect(envios).toHaveLength(1);
    const corpo = envios[0]?.[1] as FormData;
    expect(corpo).toBeInstanceOf(FormData);
    expect(corpo.get('restaurante_id')).toBe('1');
    expect(corpo.get('imagem')).toBeInstanceOf(File);

    expect(campo('descricao')).toHaveValue('Hortifruti Sol');
    expect(campo('valor')).toHaveValue('123,45');
    expect(campo('vencimento')).toHaveValue('2026-11-05');
    expect(campo('recebimento')).toHaveValue('2026-10-20');
    expect(campo('tipo')).toHaveValue('Boleto');

    expect(screen.getByTestId('ia-selo-valor')).toBeInTheDocument();
    expect(screen.getByTestId('ia-selo-dt_vencimento')).toBeInTheDocument();
    expect(screen.getByTestId('ia-selo-dt_recebimento')).toBeInTheDocument();
    expect(screen.queryByTestId('ia-selo-tipo')).not.toBeInTheDocument();
    expect(screen.getByTestId('ia-confira')).toHaveTextContent('Confira os dados antes de salvar');
    expect(screen.queryByTestId('ia-aviso')).not.toBeInTheDocument();
  });

  it('nada é gravado sem clicar no botão existente de salvar', async () => {
    await montarComPainel(1);

    escolherFoto();
    await screen.findByTestId('ia-selo-descricao');

    expect(chamadasPost('/boletos')).toHaveLength(0);
    expect(axiosMock.put).not.toHaveBeenCalled();
  });

  it('mantém o valor já digitado e avisa quando a leitura traria outro', async () => {
    await montarComPainel(1);
    fireEvent.change(campo('descricao'), { target: { value: 'Meu Fornecedor' } });

    escolherFoto();
    const aviso = await screen.findByTestId('ia-aviso');

    expect(aviso).toHaveTextContent('Mantidos os valores que você já digitou: descrição.');
    expect(campo('descricao')).toHaveValue('Meu Fornecedor');
    expect(screen.queryByTestId('ia-selo-descricao')).not.toBeInTheDocument();
    expect(screen.getByTestId('ia-selo-valor')).toBeInTheDocument();
  });

  it('campo já digitado com o mesmo valor da leitura não gera aviso nem selo', async () => {
    await montarComPainel(1);
    fireEvent.change(campo('descricao'), { target: { value: 'Hortifruti Sol' } });

    escolherFoto();
    await screen.findByTestId('ia-selo-valor');

    expect(screen.queryByTestId('ia-selo-descricao')).not.toBeInTheDocument();
    expect(screen.queryByTestId('ia-aviso')).not.toBeInTheDocument();
  });

  it('editar um campo sugerido remove só o selo dele', async () => {
    await montarComPainel(1);
    escolherFoto();
    await screen.findByTestId('ia-selo-valor');

    fireEvent.change(campo('valor'), { target: { value: '999,00' } });

    expect(screen.queryByTestId('ia-selo-valor')).not.toBeInTheDocument();
    expect(screen.getByTestId('ia-selo-descricao')).toBeInTheDocument();
  });

  it('leitura sem dados identificáveis avisa e não preenche nada', async () => {
    extrairComo(() =>
      Promise.resolve({
        data: {
          tipo_documento: null,
          tipo_sugerido: null,
          fornecedor: null,
          valor: null,
          dt_vencimento: null,
          dt_documento: null,
          linha_digitavel: null
        }
      })
    );
    await montarComPainel(1);

    escolherFoto();
    const aviso = await screen.findByTestId('ia-aviso');

    expect(aviso).toHaveTextContent('Não foi possível identificar dados nesta imagem. Preencha manualmente.');
    expect(campo('descricao')).toHaveValue('');
    expect(campo('valor')).toHaveValue('');
  });

  it('sugestão de Sem Boleto troca o tipo, tira o vencimento e usa a data do documento', async () => {
    extrairComo(() => Promise.resolve({ data: { ...SUGESTAO, tipo_sugerido: 'Sem Boleto' } }));
    await montarComPainel(1);

    escolherFoto();
    await screen.findByTestId('ia-selo-tipo');

    expect(campo('tipo')).toHaveValue('Sem Boleto');
    expect(document.querySelector('[data-boleto-campo="vencimento"]')).toBeNull();
    expect(campo('recebimento')).toHaveValue('2026-10-20');
  });
});

describe('leitura por IA: erros', () => {
  const casos: [string, number | null, { error: string } | undefined, string][] = [
    ['413 imagem grande', 413, undefined, 'Imagem muito grande. Tire a foto de novo ou escolha uma menor.'],
    ['415 formato não aceito', 415, undefined, 'Use uma foto JPG, PNG ou WebP.'],
    ['429 sem corpo usa a mensagem padrão', 429, undefined, 'Limite diário de leituras por IA atingido.'],
    [
      '429 com mensagem do servidor',
      429,
      { error: 'Limite diário de leituras por IA atingido. Tente amanhã.' },
      'Limite diário de leituras por IA atingido. Tente amanhã.'
    ],
    ['502 com mensagem do servidor', 502, { error: 'IA devolveu resposta inválida' }, 'IA devolveu resposta inválida'],
    ['503 indisponível', 503, undefined, 'Leitura por IA indisponível no momento; preencha manualmente.'],
    ['sem conexão', null, undefined, 'Sem conexão com o servidor. Preencha manualmente ou tente de novo.']
  ];

  it.each(casos)('%s mostra a mensagem esperada e o formulário manual segue usável', async (_nome, status, corpo, mensagem) => {
    extrairComo(() => Promise.reject(erroAxios(status, corpo)));
    await montarComPainel(1);

    escolherFoto();
    const alerta = await screen.findByTestId('ia-erro');

    expect(alerta).toHaveAttribute('role', 'alert');
    expect(alerta).toHaveTextContent(mensagem);
    expect(screen.queryByTestId('ia-selo-descricao')).not.toBeInTheDocument();
    expect(screen.queryByTestId('ia-selo-valor')).not.toBeInTheDocument();

    fireEvent.change(campo('descricao'), { target: { value: 'Preenchido na mão' } });
    expect(campo('descricao')).toHaveValue('Preenchido na mão');
    expect(campo('descricao')).toBeEnabled();
    expect(botaoSalvar()).toBeEnabled();
    expect(screen.getByTestId('ia-input-arquivo')).toBeEnabled();
    expect(chamadasPost('/boletos')).toHaveLength(0);
  });

  it('erro ao reduzir a foto mostra "Imagem muito grande" e nem cria a URL da foto', async () => {
    reduzirMock.mockImplementation(() => Promise.reject(new Error('Imagem muito grande')));
    await montarComPainel(1);

    escolherFoto();
    const alerta = await screen.findByTestId('ia-erro');

    expect(alerta).toHaveTextContent('Imagem muito grande. Tire a foto de novo ou escolha uma menor.');
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(chamadasPost('/boletos/extrair')).toHaveLength(0);
    expect(screen.queryByTestId('ia-ver-imagem')).not.toBeInTheDocument();
  });
});

describe('leitura por IA: cancelamento', () => {
  it('cancelar durante a leitura aborta a requisição e libera o formulário', async () => {
    const captura: { sinal?: AbortSignal } = {};
    axiosMock.post.mockImplementation((url: string, _corpo: unknown, opcoes: { signal: AbortSignal }) => {
      if (!url.endsWith('/boletos/extrair')) return Promise.resolve({ data: {} });
      captura.sinal = opcoes.signal;
      return new Promise((_resolve, reject) => {
        opcoes.signal.addEventListener('abort', () => reject(cancelamento()));
      });
    });
    await montarComPainel(1);

    escolherFoto();
    fireEvent.click(await screen.findByTestId('ia-cancelar'));

    expect(captura.sinal?.aborted).toBe(true);
    await waitFor(() => expect(screen.queryByTestId('ia-cancelar')).not.toBeInTheDocument());
    expect(screen.queryByTestId('ia-erro')).not.toBeInTheDocument();
    expect(screen.getByTestId('ia-input-arquivo')).toBeEnabled();
    expect(screen.queryByTestId('ia-ver-imagem')).not.toBeInTheDocument();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:ia-1');
    expect(campo('descricao')).toHaveValue('');
  });

  it('resposta que chega depois do cancelamento é descartada', async () => {
    const controle: { liberar?: (resposta: { data: SugestaoBoleto }) => void } = {};
    extrairComo(
      () =>
        new Promise((resolve) => {
          controle.liberar = resolve;
        })
    );
    await montarComPainel(1);

    escolherFoto();
    await waitFor(() => expect(controle.liberar).toBeDefined());
    fireEvent.click(screen.getByTestId('ia-cancelar'));

    await act(async () => {
      controle.liberar?.({ data: SUGESTAO });
    });

    expect(campo('descricao')).toHaveValue('');
    expect(campo('valor')).toHaveValue('');
    expect(screen.queryByTestId('ia-selo-descricao')).not.toBeInTheDocument();
    expect(screen.queryByTestId('ia-aviso')).not.toBeInTheDocument();
  });
});

describe('foto na sessão (ver imagem e URL local)', () => {
  it('"Ver imagem" aparece após escolher a foto e abre o preview com ela', async () => {
    await montarComPainel(1);

    const arquivo = escolherFoto();
    const botao = await screen.findByTestId('ia-ver-imagem');

    expect(URL.createObjectURL).toHaveBeenCalledWith(arquivo);

    fireEvent.click(botao);
    const dialogo = screen.getByRole('dialog', { name: 'Imagem do documento' });
    expect(screen.getByRole('img', { name: /Foto do boleto/ })).toHaveAttribute('src', 'blob:ia-1');

    fireEvent.click(screen.getByTestId('ia-preview-fechar'));
    expect(dialogo).not.toBeInTheDocument();
    await waitFor(() => expect(botao).toHaveFocus());
  });

  it('salvar o lançamento descarta a foto e libera a URL', async () => {
    await montarComPainel(1);
    escolherFoto();
    await screen.findByTestId('ia-ver-imagem');

    fireEvent.click(botaoSalvar());

    await waitFor(() => expect(chamadasPost('/boletos')).toHaveLength(1));
    await waitFor(() => expect(screen.queryByTestId('ia-ver-imagem')).not.toBeInTheDocument());
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:ia-1');
  });

  it('editar um lançamento descarta a foto', async () => {
    boletosNoServidor = [BOLETO_EXISTENTE];
    await montarComPainel(1);
    escolherFoto();
    await screen.findByTestId('ia-ver-imagem');

    const linha = (await screen.findByText('Fornecedor A')).closest('tr') as HTMLElement;
    fireEvent.click(within(linha).getByRole('button', { name: 'Editar' }));

    await waitFor(() => expect(screen.queryByTestId('ia-ver-imagem')).not.toBeInTheDocument());
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:ia-1');
  });

  it('trocar de restaurante descarta a foto', async () => {
    const { rerender } = await montarComPainel(1);
    escolherFoto();
    await screen.findByTestId('ia-ver-imagem');

    rerender(<BoletosModulo restauranteId={2} restauranteNome="Restaurante B" />);

    await waitFor(() => expect(screen.queryByTestId('ia-ver-imagem')).not.toBeInTheDocument());
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:ia-1');
  });

  it('escolher outra foto revoga a URL anterior antes de criar a nova', async () => {
    await montarComPainel(1);
    escolherFoto('primeira.jpg');
    await screen.findByTestId('ia-ver-imagem');

    escolherFoto('segunda.jpg');

    await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalledTimes(2));
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:ia-1');
    expect(URL.revokeObjectURL).not.toHaveBeenCalledWith('blob:ia-2');
  });

  it('desmontar o módulo revoga a URL da foto', async () => {
    const { unmount } = await montarComPainel(1);
    escolherFoto();
    await screen.findByTestId('ia-ver-imagem');

    unmount();

    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:ia-1');
  });
});

describe('linha digitável', () => {
  beforeEach(() => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: jest.fn(() => Promise.resolve()) },
      configurable: true
    });
  });

  it('mostra a linha como somente leitura e copia para a área de transferência', async () => {
    await montarComPainel(1);
    escolherFoto();

    const bloco = await screen.findByTestId('ia-linha-digitavel');
    const entrada = within(bloco).getByRole('textbox', { name: 'Linha digitável lida' });
    expect(entrada).toHaveValue(SUGESTAO.linha_digitavel);
    expect(entrada).toHaveAttribute('readonly');
    expect(bloco).toHaveTextContent('Linha digitável lida (não é salva)');

    fireEvent.click(within(bloco).getByRole('button', { name: 'Copiar' }));

    await waitFor(() => expect(within(bloco).getByRole('button', { name: 'Copiado' })).toBeInTheDocument());
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(SUGESTAO.linha_digitavel);
  });

  it('a linha digitável não é enviada ao salvar', async () => {
    await montarComPainel(1);
    escolherFoto();
    await screen.findByTestId('ia-selo-valor');

    fireEvent.click(botaoSalvar());

    await waitFor(() => expect(chamadasPost('/boletos')).toHaveLength(1));
    const payload = chamadasPost('/boletos')[0]?.[1];
    expect(payload).toEqual({
      restaurante_id: 1,
      dt_recebimento: '2026-10-20',
      dt_vencimento: '2026-11-05',
      descricao: 'Hortifruti Sol',
      valor: 123.45,
      tipo: 'Boleto'
    });
    expect(JSON.stringify(payload)).not.toContain('23790');
  });
});
