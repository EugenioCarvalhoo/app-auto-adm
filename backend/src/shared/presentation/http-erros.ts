import type { Response } from 'express';
import { STATUS_CODES } from 'http';
import type { CodigoErroAplicacao } from '../domain/erros';

/** Tradução do código de erro da aplicação em status HTTP (os mesmos que a API Express devolvia). */
export const STATUS_POR_CODIGO: Record<CodigoErroAplicacao, number> = {
  VALIDACAO: 400,
  NAO_AUTENTICADO: 401,
  TOKEN_INVALIDO: 403,
  PROIBIDO: 403,
  NAO_ENCONTRADO: 404,
  CONFLITO: 409,
  PAYLOAD_GRANDE: 413,
  TIPO_NAO_SUPORTADO: 415,
  LIMITE_EXCEDIDO: 429,
  PROVEDOR_INDISPONIVEL: 502,
  INDISPONIVEL: 503,
  INTERNO: 500
};

function escaparHtml(texto: string): string {
  return texto
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/\n/g, '<br>')
    .replace(/ {2}/g, ' &nbsp;');
}

/** Resposta de erro HTML no formato do tratador padrão do Express (rotas inexistentes, JSON malformado etc.). */
export function responderHtmlPadraoExpress(res: Response, status: number, texto: string): void {
  const corpo =
    '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<title>Error</title>\n</head>\n<body>\n<pre>' +
    escaparHtml(texto) +
    '</pre>\n</body>\n</html>\n';
  res.status(status);
  res.setHeader('Content-Security-Policy', "default-src 'none'");
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Content-Length', Buffer.byteLength(corpo));
  res.end(corpo);
}

/** Texto exibido no HTML: stack fora de produção, nome do status em produção (como o Express). */
export function textoErroPadraoExpress(status: number, erro: unknown): string {
  if (process.env.NODE_ENV === 'production') return STATUS_CODES[status] || String(status);
  if (erro instanceof Error) return erro.stack || erro.toString();
  return String(erro);
}
