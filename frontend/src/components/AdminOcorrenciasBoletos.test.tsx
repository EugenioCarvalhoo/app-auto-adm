jest.mock('axios', () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
    post: jest.fn(),
    isAxiosError: (e: unknown) => typeof e === 'object' && e !== null && 'isAxiosError' in e,
    interceptors: {
      request: { use: jest.fn(), eject: jest.fn() },
      response: { use: jest.fn(), eject: jest.fn() },
    },
  },
}));

jest.mock('../config', () => ({ API_URL: 'http://api.test' }));

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import axios from 'axios';
import type { OcorrenciaBoleto } from '../types';
import AdminOcorrenciasBoletos from './AdminOcorrenciasBoletos';

const mAxios = axios as jest.Mocked<typeof axios>;

const ocorrencia = (extra: Partial<OcorrenciaBoleto> = {}): OcorrenciaBoleto => ({
  id: 1,
  tipo: 'linha_duplicada',
  usuario_id: 2,
  usuario_nome: 'Maria Gerente',
  usuario_username: 'maria',
  restaurante_id: 1,
  restaurante_nome: 'Restaurante A',
  boleto_existente_id: 9,
  boleto_existente_restaurante_nome: 'Restaurante B',
  boleto_existente_fornecedor: 'Forn B',
  linha_digitavel: '00190500954014481606906809350314337370000000100',
  visto_em: null,
  created_at: '2026-10-21T15:00:00.000Z',
  ...extra,
});

beforeEach(() => jest.clearAllMocks());

describe('AdminOcorrenciasBoletos', () => {
  test('lista as ocorrências com usuário, restaurante e onde a linha já existia', async () => {
    mAxios.get.mockResolvedValueOnce({ data: [ocorrencia()] });
    render(<AdminOcorrenciasBoletos />);

    expect(await screen.findByText('Maria Gerente')).toBeInTheDocument();
    expect(mAxios.get).toHaveBeenCalledWith('http://api.test/admin/boletos-ocorrencias');
    expect(screen.getByText(/Restaurante: Restaurante A/)).toBeInTheDocument();
    expect(screen.getByText(/Já cadastrada em: Restaurante B \(Forn B\)/)).toBeInTheDocument();
    expect(screen.getByText('00190.50095 40144.816069 06809.350314 3 37370000000100')).toBeInTheDocument();
  });

  test('sem ocorrências mostra a mensagem de vazio', async () => {
    mAxios.get.mockResolvedValueOnce({ data: [] });
    render(<AdminOcorrenciasBoletos />);
    expect(await screen.findByText('Nenhuma ocorrência pendente.')).toBeInTheDocument();
  });

  test('"Marcar como vista" chama a API e remove o item da lista', async () => {
    mAxios.get.mockResolvedValueOnce({ data: [ocorrencia({ id: 1 }), ocorrencia({ id: 2, usuario_nome: 'João' })] });
    mAxios.post.mockResolvedValueOnce({ data: { id: 1 } });
    render(<AdminOcorrenciasBoletos />);

    await screen.findByText('Maria Gerente');
    fireEvent.click(screen.getAllByRole('button', { name: /marcar como vista/i })[0] as HTMLElement);

    await waitFor(() => expect(mAxios.post).toHaveBeenCalledWith('http://api.test/admin/boletos-ocorrencias/1/visto'));
    await waitFor(() => expect(screen.queryByText('Maria Gerente')).not.toBeInTheDocument());
    expect(screen.getByText('João')).toBeInTheDocument();
  });

  test('erro ao marcar mantém o item e mostra o aviso', async () => {
    mAxios.get.mockResolvedValueOnce({ data: [ocorrencia()] });
    mAxios.post.mockRejectedValueOnce({ isAxiosError: true, response: { status: 500, data: { error: 'Falhou' }, headers: {} } });
    render(<AdminOcorrenciasBoletos />);

    await screen.findByText('Maria Gerente');
    fireEvent.click(screen.getByRole('button', { name: /marcar como vista/i }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('Maria Gerente')).toBeInTheDocument();
  });

  test('falha ao carregar mostra erro com "Tentar de novo"', async () => {
    mAxios.get.mockRejectedValueOnce({ isAxiosError: true, response: { status: 500, data: {}, headers: {} } });
    render(<AdminOcorrenciasBoletos />);
    expect(await screen.findByRole('alert')).toBeInTheDocument();

    mAxios.get.mockResolvedValueOnce({ data: [ocorrencia()] });
    fireEvent.click(screen.getByRole('button', { name: /tentar de novo/i }));
    expect(await screen.findByText('Maria Gerente')).toBeInTheDocument();
  });
});
