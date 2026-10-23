jest.mock('axios', () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    delete: jest.fn(),
    isAxiosError: (e: unknown) => typeof e === 'object' && e !== null && 'isAxiosError' in e,
    interceptors: {
      request: { use: jest.fn(), eject: jest.fn() },
      response: { use: jest.fn(), eject: jest.fn() },
    },
  },
}));

jest.mock('../../config', () => ({ API_URL: 'http://api.test' }));

jest.mock('../../lib/imagem', () => ({
  comprimirImagem: jest.fn(),
}));

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import axios from 'axios';
import { comprimirImagem } from '../../lib/imagem';
import type { Boleto, ExtracaoResposta } from '../../types';
import BoletosModulo from './BoletosModulo';

const mAxios = axios as jest.Mocked<typeof axios>;

function boleto(extra: Partial<Boleto> = {}): Boleto {
  return {
    id: 10,
    restaurante_id: 1,
    dt_recebimento: '2026-10-20',
    dt_vencimento: '2026-11-05',
    descricao: 'Hortifruti',
    valor: 150.5,
    tipo: 'Boleto',
    dt_vencimento_efetivo: '2026-11-05',
    semana_inicio: '2026-10-31',
    semana_fim: '2026-11-06',
    semana_chave: '20261031.20261106',
    created_at: null,
    fornecedor: 'Hortifruti Sol',
    linha_digitavel: null,
    pago: false,
    pago_em: null,
    pago_por_usuario_id: null,
    anexo_id: null,
    tem_anexo: false,
    ...extra,
  };
}

function servir(lista: Boleto[]) {
  mAxios.get.mockImplementation(async (url: string) => {
    if (url.endsWith('/boletos/resumo')) return { data: { semanas: [], total_geral: 0 } };
    if (url.endsWith('/boletos/metas')) return { data: [] };
    return { data: lista };
  });
}

function erro409(data: unknown) {
  return { isAxiosError: true, response: { status: 409, data, headers: {} } };
}

async function renderizar(props: Partial<React.ComponentProps<typeof BoletosModulo>> = {}, lista: Boleto[] = [boleto()]) {
  servir(lista);
  const r = render(<BoletosModulo restauranteId={1} restauranteNome="Restaurante A" onMessage={jest.fn()} {...props} />);
  await screen.findByText('Registros Cadastrados');
  return r;
}

beforeEach(() => {
  // O CRA usa resetMocks: true, então as implementações são refeitas a cada teste.
  (comprimirImagem as jest.Mock).mockImplementation(async (b: Blob) => b);
  mAxios.post.mockResolvedValue({ data: {} });
  mAxios.delete.mockResolvedValue({ data: {} });
  // jsdom não implementa scrollIntoView
  Element.prototype.scrollIntoView = jest.fn();
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, writable: true, value: jest.fn(() => 'blob:previa') });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, writable: true, value: jest.fn() });
});

describe('BoletosModulo: pagamento', () => {
  test('"Marcar como pago" só aparece com permissão', async () => {
    const { unmount } = await renderizar({ podeMarcarPago: false });
    expect(screen.queryByRole('button', { name: /marcar como pago/i })).not.toBeInTheDocument();
    unmount();

    await renderizar({ podeMarcarPago: true });
    expect(screen.getByRole('button', { name: /marcar como pago/i })).toBeInTheDocument();
  });

  test('boleto pago mostra o selo e não oferece "Marcar como pago"', async () => {
    await renderizar({ podeMarcarPago: true }, [boleto({ pago: true, pago_em: '2026-10-21T15:00:00.000Z' })]);
    expect(screen.getByText(/Pago em/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /marcar como pago/i })).not.toBeInTheDocument();
  });

  test('clicar em "Marcar como pago" chama POST /boletos/:id/pago e recarrega a lista', async () => {
    await renderizar({ podeMarcarPago: true });
    const chamadasAntes = mAxios.get.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: /marcar como pago/i }));
    await waitFor(() => expect(mAxios.post).toHaveBeenCalledWith('http://api.test/boletos/10/pago'));
    await waitFor(() => expect(mAxios.get.mock.calls.length).toBeGreaterThan(chamadasAntes));
  });

  test('boleto pago: não-admin vê Editar/Excluir desabilitados com aviso; admin segue com as ações', async () => {
    const pago = boleto({ pago: true, pago_em: '2026-10-21T15:00:00.000Z' });
    const { unmount } = await renderizar({ podeDesfazerPago: false }, [pago]);
    screen.getAllByRole('button', { name: 'Editar' }).forEach((b) => expect(b).toBeDisabled());
    screen.getAllByRole('button', { name: 'Excluir' }).forEach((b) => expect(b).toBeDisabled());
    expect(screen.getAllByText('Pago: só o administrador altera').length).toBeGreaterThan(0);
    unmount();

    await renderizar({ podeDesfazerPago: true }, [pago]);
    screen.getAllByRole('button', { name: 'Editar' }).forEach((b) => expect(b).toBeEnabled());
    expect(screen.queryByText('Pago: só o administrador altera')).not.toBeInTheDocument();
  });

  test('"Desfazer pagamento" só para quem pode e só em boleto pago', async () => {
    const pago = boleto({ pago: true, pago_em: '2026-10-21T15:00:00.000Z' });
    const { unmount } = await renderizar({ podeDesfazerPago: false }, [pago]);
    expect(screen.queryByRole('button', { name: /desfazer pagamento/i })).not.toBeInTheDocument();
    unmount();

    const r2 = await renderizar({ podeDesfazerPago: true }, [boleto()]);
    expect(screen.queryByRole('button', { name: /desfazer pagamento/i })).not.toBeInTheDocument();
    r2.unmount();

    await renderizar({ podeDesfazerPago: true }, [pago]);
    expect(screen.getByRole('button', { name: /desfazer pagamento/i })).toBeInTheDocument();
  });

  test('desfazer exige motivo de 5+ caracteres antes de chamar a API', async () => {
    await renderizar({ podeDesfazerPago: true }, [boleto({ pago: true, pago_em: '2026-10-21T15:00:00.000Z' })]);
    fireEvent.click(screen.getByRole('button', { name: /desfazer pagamento/i }));

    const modal = await screen.findByRole('dialog', { name: /desfazer pagamento/i });
    const campo = within(modal).getByRole('textbox');
    fireEvent.change(campo, { target: { value: 'abc' } });
    fireEvent.click(within(modal).getByRole('button', { name: /^desfazer pagamento$/i }));

    expect(await within(modal).findByRole('alert')).toHaveTextContent(/5 a 500/);
    expect(mAxios.delete).not.toHaveBeenCalled();

    fireEvent.change(campo, { target: { value: '  Pago em duplicidade  ' } });
    fireEvent.click(within(modal).getByRole('button', { name: /^desfazer pagamento$/i }));
    await waitFor(() =>
      expect(mAxios.delete).toHaveBeenCalledWith('http://api.test/boletos/10/pago', { data: { motivo: 'Pago em duplicidade' } })
    );
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /desfazer pagamento/i })).not.toBeInTheDocument());
  });

  test('cancelar o modal de desfazer não chama a API', async () => {
    await renderizar({ podeDesfazerPago: true }, [boleto({ pago: true, pago_em: '2026-10-21T15:00:00.000Z' })]);
    fireEvent.click(screen.getByRole('button', { name: /desfazer pagamento/i }));
    const modal = await screen.findByRole('dialog', { name: /desfazer pagamento/i });
    fireEvent.click(within(modal).getByRole('button', { name: /cancelar/i }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(mAxios.delete).not.toHaveBeenCalled();
  });
});

describe('BoletosModulo: lançamento parecido (409 BOLETO_SIMILAR)', () => {
  async function preencherEEnviar() {
    await renderizar();
    fireEvent.change(screen.getByLabelText(/dt\. recebimento/i), { target: { value: '2026-10-20' } });
    fireEvent.change(screen.getByLabelText(/dt\. vencimento/i), { target: { value: '2026-11-05' } });
    fireEvent.change(screen.getByLabelText(/^fornecedor/i), { target: { value: 'Hortifruti Sol' } });
    fireEvent.change(screen.getByLabelText(/^descrição/i), { target: { value: 'Hortifruti' } });
    fireEvent.change(screen.getByLabelText(/valor \(r\$\)/i), { target: { value: '150,50' } });
    fireEvent.click(screen.getByRole('button', { name: /^adicionar$/i }));
  }

  test('mostra o modal com os parecidos; Cancelar fecha sem cadastrar', async () => {
    mAxios.post.mockRejectedValueOnce(erro409({ codigo: 'BOLETO_SIMILAR', boletos: [boleto({ id: 77, fornecedor: 'Hortifruti Sol' })] }));
    await preencherEEnviar();

    const modal = await screen.findByRole('dialog', { name: /parecido/i });
    expect(within(modal).getByText(/Hortifruti Sol/)).toBeInTheDocument();
    expect(mAxios.post).toHaveBeenCalledTimes(1);
    expect(mAxios.post.mock.calls[0]?.[1]).not.toHaveProperty('confirmar_similar');

    fireEvent.click(within(modal).getByRole('button', { name: /cancelar/i }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(mAxios.post).toHaveBeenCalledTimes(1);
  });

  test('"Cadastrar mesmo assim" reenvia com confirmar_similar: true', async () => {
    mAxios.post.mockRejectedValueOnce(erro409({ codigo: 'BOLETO_SIMILAR', boletos: [boleto({ id: 77 })] }));
    await preencherEEnviar();

    const modal = await screen.findByRole('dialog', { name: /parecido/i });
    fireEvent.click(within(modal).getByRole('button', { name: /cadastrar mesmo assim/i }));

    await waitFor(() => expect(mAxios.post).toHaveBeenCalledTimes(2));
    expect(mAxios.post.mock.calls[1]?.[1]).toMatchObject({ confirmar_similar: true, fornecedor: 'Hortifruti Sol', valor: 150.5 });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  test('409 de linha duplicada NÃO abre o modal: mostra a mensagem do servidor', async () => {
    const onMessage = jest.fn();
    mAxios.post.mockRejectedValueOnce({
      isAxiosError: true,
      response: { status: 409, data: { codigo: 'LINHA_DUPLICADA', error: 'Esta linha digitável já está cadastrada.' }, headers: {} },
    });
    servir([boleto()]);
    render(<BoletosModulo restauranteId={1} onMessage={onMessage} />);
    await screen.findByText('Registros Cadastrados');
    fireEvent.change(screen.getByLabelText(/dt\. recebimento/i), { target: { value: '2026-10-20' } });
    fireEvent.change(screen.getByLabelText(/dt\. vencimento/i), { target: { value: '2026-11-05' } });
    fireEvent.change(screen.getByLabelText(/^descrição/i), { target: { value: 'X' } });
    fireEvent.change(screen.getByLabelText(/valor \(r\$\)/i), { target: { value: '10' } });
    fireEvent.click(screen.getByRole('button', { name: /^adicionar$/i }));

    await waitFor(() => expect(onMessage).toHaveBeenCalledWith(expect.stringMatching(/já está cadastrada/)));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('BoletosModulo: leitura por imagem', () => {
  function escolherFoto() {
    const input = screen.getByLabelText('Escolher imagem do boleto');
    const arquivo = new File([new Uint8Array([0xff, 0xd8, 0xff])], 'foto.jpg', { type: 'image/jpeg' });
    fireEvent.change(input, { target: { files: [arquivo] } });
  }

  const HASH = 'a'.repeat(64);
  const extracao = (extra: Partial<ExtracaoResposta> = {}): ExtracaoResposta => ({
    hash_sha256: HASH,
    tipo_documento: 'boleto',
    tipo_sugerido: 'Boleto',
    fornecedor: 'Distribuidora Sol',
    valor: 321.45,
    dt_vencimento: '2026-11-10',
    dt_recebimento: '2026-10-21',
    linha_digitavel: '00190500954014481606906809350314337370000000100',
    campos_nao_lidos: [],
    avisos: [],
    ...extra,
  });

  test('os botões de câmera e galeria existem (a visibilidade por tela é CSS)', async () => {
    await renderizar();
    expect(document.querySelector('[data-boleto-ia="camera"]')).not.toBeNull();
    expect(document.querySelector('[data-boleto-ia="galeria"]')).not.toBeNull();
    expect(screen.getByText(/disponível no celular/i)).toBeInTheDocument();
  });

  test('pré-preenche o formulário, não salva sozinho e só sobe a imagem após o 201 (sem anexo_id)', async () => {
    await renderizar();
    mAxios.post.mockResolvedValueOnce({ data: extracao() });
    escolherFoto();

    await screen.findByText(/Dados lidos por IA/i);
    expect(mAxios.post).toHaveBeenCalledTimes(1);
    const [url, corpo] = mAxios.post.mock.calls[0] as [string, FormData];
    expect(url).toBe('http://api.test/boletos/extrair');
    expect(corpo.get('restaurante_id')).toBe('1');
    expect(corpo.get('forcar_repetida')).toBeNull();

    expect(screen.getByLabelText(/^fornecedor/i)).toHaveValue('Distribuidora Sol');
    expect(screen.getByLabelText(/valor \(r\$\)/i)).toHaveValue('321,45');
    expect(screen.getByLabelText(/dt\. vencimento/i)).toHaveValue('2026-11-10');
    expect(screen.getByLabelText(/dt\. recebimento/i)).toHaveValue('2026-10-21');
    expect(screen.queryByText(/Não lido/)).not.toBeInTheDocument();

    mAxios.post.mockResolvedValueOnce({ data: boleto({ id: 99 }) });
    mAxios.post.mockResolvedValueOnce({ data: boleto({ id: 99, tem_anexo: true }) });
    fireEvent.click(screen.getByRole('button', { name: /^adicionar$/i }));
    await waitFor(() => expect(mAxios.post).toHaveBeenCalledTimes(3));
    expect(mAxios.post.mock.calls[1]?.[0]).toBe('http://api.test/boletos');
    expect(mAxios.post.mock.calls[1]?.[1]).toMatchObject({
      fornecedor: 'Distribuidora Sol',
      linha_digitavel: '00190500954014481606906809350314337370000000100',
    });
    expect(mAxios.post.mock.calls[1]?.[1]).not.toHaveProperty('anexo_id');
    expect(mAxios.post.mock.calls[2]?.[0]).toBe('http://api.test/boletos/99/anexo');
    const anexo = mAxios.post.mock.calls[2]?.[1] as FormData;
    expect(anexo.get('hash_sha256')).toBe(HASH);
    expect(anexo.get('imagem')).toBeInstanceOf(Blob);
    expect(screen.queryByText(/não foi anexada/)).not.toBeInTheDocument();
  });

  test('409 de similaridade: a imagem só sobe depois do reenvio com 201', async () => {
    await renderizar();
    mAxios.post.mockResolvedValueOnce({ data: extracao() });
    escolherFoto();
    await screen.findByText(/Dados lidos por IA/i);

    mAxios.post.mockRejectedValueOnce(erro409({ codigo: 'BOLETO_SIMILAR', boletos: [boleto({ id: 77 })] }));
    fireEvent.click(screen.getByRole('button', { name: /^adicionar$/i }));
    const modal = await screen.findByRole('dialog', { name: /parecido/i });
    expect(mAxios.post).toHaveBeenCalledTimes(2);

    mAxios.post.mockResolvedValueOnce({ data: boleto({ id: 100 }) });
    mAxios.post.mockResolvedValueOnce({ data: boleto({ id: 100, tem_anexo: true }) });
    fireEvent.click(within(modal).getByRole('button', { name: /cadastrar mesmo assim/i }));
    await waitFor(() => expect(mAxios.post).toHaveBeenCalledTimes(4));
    expect(mAxios.post.mock.calls[3]?.[0]).toBe('http://api.test/boletos/100/anexo');
  });

  test('falha ao enviar a imagem mantém o boleto e permite reenviar sem duplicar o cadastro', async () => {
    await renderizar();
    mAxios.post.mockResolvedValueOnce({ data: extracao() });
    escolherFoto();
    await screen.findByText(/Dados lidos por IA/i);

    mAxios.post.mockResolvedValueOnce({ data: boleto({ id: 99 }) });
    mAxios.post.mockRejectedValueOnce({
      isAxiosError: true,
      response: { status: 503, data: { error: 'Armazenamento de imagens não configurado' }, headers: {} },
    });
    fireEvent.click(screen.getByRole('button', { name: /^adicionar$/i }));

    const alerta = await screen.findByText(/O lançamento foi salvo, mas a imagem não foi anexada/);
    expect(alerta).toHaveTextContent(/Armazenamento de imagens não configurado/);
    expect(mAxios.post).toHaveBeenCalledTimes(3);

    mAxios.post.mockResolvedValueOnce({ data: boleto({ id: 99, tem_anexo: true }) });
    fireEvent.click(screen.getByRole('button', { name: /enviar imagem novamente/i }));
    await waitFor(() => expect(mAxios.post).toHaveBeenCalledTimes(4));
    expect(mAxios.post.mock.calls[3]?.[0]).toBe('http://api.test/boletos/99/anexo');
    expect((mAxios.post.mock.calls[3]?.[1] as FormData).get('hash_sha256')).toBe(HASH);
    // nenhum segundo POST /boletos
    expect(mAxios.post.mock.calls.filter((c) => c[0] === 'http://api.test/boletos')).toHaveLength(1);
    await waitFor(() => expect(screen.queryByText(/não foi anexada/)).not.toBeInTheDocument());
  });

  test('409 "já tem imagem" não oferece reenvio', async () => {
    await renderizar();
    mAxios.post.mockResolvedValueOnce({ data: extracao() });
    escolherFoto();
    await screen.findByText(/Dados lidos por IA/i);

    mAxios.post.mockResolvedValueOnce({ data: boleto({ id: 99 }) });
    mAxios.post.mockRejectedValueOnce(erro409({ error: 'Este lançamento já tem imagem.' }));
    fireEvent.click(screen.getByRole('button', { name: /^adicionar$/i }));
    await screen.findByText(/já tem imagem/);
    expect(screen.queryByRole('button', { name: /enviar imagem novamente/i })).not.toBeInTheDocument();
  });

  test('destaca os campos não lidos e some o destaque ao editar o campo', async () => {
    await renderizar();
    mAxios.post.mockResolvedValueOnce({
      data: extracao({ fornecedor: null, valor: null, campos_nao_lidos: ['fornecedor', 'valor'] }),
    });
    escolherFoto();
    await screen.findByText(/Dados lidos por IA/i);

    expect(screen.getAllByText(/Não lido: confira ou preencha/)).toHaveLength(2);
    fireEvent.change(screen.getByLabelText(/valor \(r\$\)/i), { target: { value: '10' } });
    expect(screen.getAllByText(/Não lido: confira ou preencha/)).toHaveLength(1);
  });

  test('tipo_sugerido null: assume Boleto no formulário mas pede ao usuário que escolha o tipo', async () => {
    await renderizar();
    mAxios.post.mockResolvedValueOnce({
      data: extracao({ tipo_sugerido: null, linha_digitavel: null, avisos: ['Imagem não identificada como boleto.'], campos_nao_lidos: [] }),
    });
    escolherFoto();
    await screen.findByText(/Dados lidos por IA/i);
    expect(screen.getByText(/Imagem não identificada como boleto: escolha o tipo/)).toBeInTheDocument();
    expect(screen.getByText(/⚠ Imagem não identificada como boleto\./)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/tipo de dado/i), { target: { value: 'Sem Boleto' } });
    expect(screen.queryByText(/escolha o tipo/)).not.toBeInTheDocument();
  });

  test('nota: tipo "Sem Boleto" sugerido, sem campo de vencimento nem linha', async () => {
    await renderizar();
    mAxios.post.mockResolvedValueOnce({
      data: extracao({ tipo_documento: 'nota', tipo_sugerido: 'Sem Boleto', dt_vencimento: null, dt_recebimento: null, linha_digitavel: null }),
    });
    escolherFoto();
    await screen.findByText(/Dados lidos por IA/i);
    expect(screen.getByLabelText(/tipo de dado/i)).toHaveValue('Sem Boleto');
    expect(screen.queryByLabelText(/dt\. vencimento/i)).not.toBeInTheDocument();
    expect(document.querySelector('[data-boleto-campo="linha_digitavel"]')).toBeNull();
  });

  test('imagem repetida: avisa e "Ler mesmo assim" reenvia com forcar_repetida', async () => {
    await renderizar();
    mAxios.post.mockResolvedValueOnce({ data: extracao({ tipo_sugerido: null, aviso_imagem_repetida: boleto() }) });
    escolherFoto();
    expect(await screen.findByText(/já foi cadastrada neste restaurante/i)).toBeInTheDocument();
    expect(screen.queryByText(/Dados lidos por IA/i)).not.toBeInTheDocument();

    mAxios.post.mockResolvedValueOnce({ data: extracao() });
    fireEvent.click(screen.getByRole('button', { name: /ler mesmo assim/i }));
    await screen.findByText(/Dados lidos por IA/i);
    const corpo = mAxios.post.mock.calls[1]?.[1] as FormData;
    expect(corpo.get('forcar_repetida')).toBe('true');
  });

  test('erro da IA mostra a mensagem, oferece tentar de novo e não preenche o formulário', async () => {
    await renderizar();
    mAxios.post.mockRejectedValueOnce({
      isAxiosError: true,
      response: { status: 502, data: { error: 'Não foi possível ler a imagem agora.' }, headers: {} },
    });
    escolherFoto();
    const alerta = await screen.findByRole('alert');
    expect(alerta).toHaveTextContent(/Não foi possível ler a imagem agora/);
    expect(screen.getByRole('button', { name: /tentar de novo/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/valor \(r\$\)/i)).toHaveValue('');
  });

  test('429 informa o tempo de espera do Retry-After', async () => {
    await renderizar();
    mAxios.post.mockRejectedValueOnce({
      isAxiosError: true,
      response: { status: 429, data: { error: 'Muitas leituras.' }, headers: { 'retry-after': '42' } },
    });
    escolherFoto();
    expect(await screen.findByRole('alert')).toHaveTextContent(/Tente novamente em 42 s/);
  });
});

describe('BoletosModulo: limite diário de leituras', () => {
  test('LIMITE_DIARIO: sem "tentar de novo", orienta cadastro manual e desabilita a IA', async () => {
    await renderizar();
    mAxios.post.mockRejectedValueOnce({
      isAxiosError: true,
      response: { status: 429, data: { error: 'Limite diário de leituras por IA atingido', codigo: 'LIMITE_DIARIO' }, headers: { 'retry-after': '30' } },
    });
    const input = screen.getByLabelText('Escolher imagem do boleto');
    fireEvent.change(input, { target: { files: [new File([new Uint8Array([0xff, 0xd8, 0xff])], 'f.jpg', { type: 'image/jpeg' })] } });

    const alerta = await screen.findByRole('alert');
    expect(alerta).toHaveTextContent(/Limite diário de leituras por IA atingido/);
    expect(alerta).toHaveTextContent(/manualmente/);
    expect(alerta).not.toHaveTextContent(/Tente novamente em/);
    expect(screen.queryByRole('button', { name: /tentar de novo/i })).not.toBeInTheDocument();
    expect(document.querySelector('[data-boleto-ia="camera"]')).toBeDisabled();
    expect(document.querySelector('[data-boleto-ia="galeria"]')).toBeDisabled();
  });
});
