import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import '../lib/loadEnv';

/** Payload do JWT (req.user). As flags são só informativas: a autorização lê o banco (loadUserFlags). */
export interface AuthUser {
  id: number;
  username?: string;
  is_admin?: boolean;
  modulo_boletos?: boolean;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export const JWT_SECRET: string = process.env.JWT_SECRET || 'sua_chave_secreta_super_segura_aqui';

if (!JWT_SECRET || JWT_SECRET === 'sua_chave_secreta_super_segura_aqui') {
  console.warn('AVISO: JWT_SECRET não configurado, usando chave padrão. Configure JWT_SECRET no .env para produção!');
}

export const authenticateToken = (req: Request, res: Response, next: NextFunction): void | Response => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({ error: 'Token de acesso não fornecido' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Token inválido ou expirado' });
    }
    req.user = user as unknown as AuthUser;
    next();
  });
};

