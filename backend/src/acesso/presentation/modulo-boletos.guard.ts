import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { ControleAcesso } from '../application/controle-acesso';
import type { RequisicaoAutenticada } from './requisicao';

/** Equivale ao antigo requireModuloBoletos (flags lidas do banco). Use depois do AuthGuard. */
@Injectable()
export class ModuloBoletosGuard implements CanActivate {
  constructor(@Inject(ControleAcesso) private readonly acesso: ControleAcesso) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<RequisicaoAutenticada>();
    await this.acesso.exigirModuloBoletos(req.user!.id);
    return true;
  }
}
