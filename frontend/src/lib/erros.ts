import axios from 'axios';

/** Corpo de erro padrão da API. */
export interface ErroApi {
  error?: string;
}

/** Mensagem `error` devolvida pela API, ou o fallback. */
export function mensagemErro(error: unknown, fallback: string): string {
  if (axios.isAxiosError<ErroApi>(error)) {
    return error.response?.data?.error || fallback;
  }
  return fallback;
}
