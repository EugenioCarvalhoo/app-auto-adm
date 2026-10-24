import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { ErroAplicacao } from '../../shared/domain/erros';
import { TOKEN_SERVICE } from '../application/portas';
import type { TokenService } from '../application/portas';
import type { RequisicaoAutenticada } from './requisicao';

/** Equivale ao antigo authenticateToken: valida o Bearer JWT e preenche req.user. */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(@Inject(TOKEN_SERVICE) private readonly tokens: TokenService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<RequisicaoAutenticada>();
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN
    if (!token) {
      throw new ErroAplicacao('NAO_AUTENTICADO', 'Token de acesso não fornecido');
    }
    try {
      req.user = this.tokens.verificar(token);
    } catch {
      throw new ErroAplicacao('TOKEN_INVALIDO', 'Token inválido ou expirado');
    }
    return true;
  }
}
