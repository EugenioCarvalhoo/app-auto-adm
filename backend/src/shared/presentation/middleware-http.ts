import type { NextFunction, Request, Response } from 'express';

/** Mantém o comportamento antigo: content-length ausente vira '0' (evita erro 431 em alguns proxies). */
export function contentLengthPadrao(req: Request, _res: Response, next: NextFunction): void {
  req.headers['content-length'] = req.headers['content-length'] || '0';
  next();
}

/** Uma linha por requisição ao fim da resposta: confirma se o proxy chega no Node. */
export function logHttp(req: Request, res: Response, next: NextFunction): void {
  const t0 = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - t0;
    console.log(`[http] ${req.method} ${req.originalUrl || req.url} -> ${res.statusCode} (${ms}ms)`);
  });
  next();
}
