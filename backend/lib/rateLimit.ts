import type { NextFunction, Request, Response } from 'express';

export interface RateLimiter {
  middleware: (req: Request, res: Response, next: NextFunction) => void | Response;
  /** Zera os contadores (testes). */
  reset: () => void;
}

/** Limite simples em memória, por usuário autenticado (janela deslizante). Uma instância por processo. */
export function criarRateLimitPorUsuario(max: number, windowMs: number): RateLimiter {
  const hits = new Map<number, number[]>();
  return {
    middleware(req, res, next) {
      const chave = req.user?.id ?? 0;
      const agora = Date.now();
      const recentes = (hits.get(chave) || []).filter((t) => agora - t < windowMs);
      if (recentes.length >= max) {
        const retry = Math.max(1, Math.ceil((windowMs - (agora - recentes[0])) / 1000));
        hits.set(chave, recentes);
        res.setHeader('Retry-After', String(retry));
        return res.status(429).json({ error: 'Muitas leituras de imagem em pouco tempo. Aguarde um instante e tente de novo.' });
      }
      recentes.push(agora);
      hits.set(chave, recentes);
      next();
    },
    reset() {
      hits.clear();
    }
  };
}

/** Limite de leituras por IA por usuário (padrão 10/min; EXTRAIR_RATE_LIMIT_MAX altera). */
export const extrairRateLimit: RateLimiter = criarRateLimitPorUsuario(Number(process.env.EXTRAIR_RATE_LIMIT_MAX) || 10, 60 * 1000);
