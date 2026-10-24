import { ArgumentsHost, Catch, ExceptionFilter, HttpException, NotFoundException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ehTabelaInexistente, ErroAplicacao, MSG_BANCO_DESATUALIZADO } from '../domain/erros';
import { responderHtmlPadraoExpress, STATUS_POR_CODIGO, textoErroPadraoExpress } from './http-erros';

/**
 * Filtro global: reproduz as respostas de erro da API Express.
 *  - ErroAplicacao -> JSON `{ error, ... }` com o status do código;
 *  - erros do framework (rota inexistente, JSON malformado, corpo grande) -> HTML padrão do Express;
 *  - qualquer outro erro (ex.: banco fora do ar num guard) -> 42P01 vira 503, o resto 500 genérico, sem vazar detalhes.
 */
@Catch()
export class TodasExcecoesFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const res = http.getResponse<Response>();
    const req = http.getRequest<Request>();

    if (res.headersSent) return;

    if (exception instanceof ErroAplicacao) {
      res.status(STATUS_POR_CODIGO[exception.codigo]).json({ error: exception.message, ...exception.extra });
      return;
    }

    if (exception instanceof NotFoundException) {
      const caminho = (req.originalUrl || req.url || '').split('?')[0];
      responderHtmlPadraoExpress(res, 404, `Cannot ${req.method} ${caminho}`);
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      responderHtmlPadraoExpress(res, status, textoErroPadraoExpress(status, exception));
      return;
    }

    // Erros do body-parser (corpo grande demais etc.) chegam com `status`/`statusCode` numérico.
    const status = statusDoErroExterno(exception);
    if (status) {
      responderHtmlPadraoExpress(res, status, textoErroPadraoExpress(status, exception));
      return;
    }

    console.error('Erro não tratado:', exception);
    if (ehTabelaInexistente(exception)) {
      res.status(503).json({ error: MSG_BANCO_DESATUALIZADO });
      return;
    }
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
}

function statusDoErroExterno(erro: unknown): number | null {
  if (erro && typeof erro === 'object') {
    const e = erro as { status?: unknown; statusCode?: unknown };
    const s = typeof e.status === 'number' ? e.status : typeof e.statusCode === 'number' ? e.statusCode : null;
    if (s && s >= 400 && s < 600) return s;
  }
  return null;
}
