import { Injectable } from '@nestjs/common';
import jwt from 'jsonwebtoken';
import { obterJwtSecret } from '../../config/env';
import type { AuthUser } from '../domain/regras';
import type { TokenService } from '../application/portas';

@Injectable()
export class JwtTokenService implements TokenService {
  private readonly secret = obterJwtSecret();

  assinar(payload: AuthUser, expiraEm: string): string {
    return jwt.sign(payload, this.secret, { expiresIn: expiraEm as jwt.SignOptions['expiresIn'] });
  }

  verificar(token: string): AuthUser {
    return jwt.verify(token, this.secret) as unknown as AuthUser;
  }
}
