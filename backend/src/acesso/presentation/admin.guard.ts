import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ErroAplicacao } from '../../shared/domain/erros';
import type { RequisicaoAutenticada } from './requisicao';

/** Equivale ao antigo requireAdmin (lê is_admin do JWT, como antes). Use depois do AuthGuard. */
@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<RequisicaoAutenticada>();
    if (!req.user || !req.user.is_admin) {
      throw new ErroAplicacao('PROIBIDO', 'Apenas administradores podem realizar esta ação.');
    }
    return true;
  }
}
