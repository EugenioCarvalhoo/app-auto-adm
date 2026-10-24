import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { AuthUser } from '../domain/regras';
import type { RequisicaoAutenticada } from './requisicao';

/** Usuário do JWT (req.user) injetado no parâmetro do handler. */
export const UsuarioAtual = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthUser => {
  return ctx.switchToHttp().getRequest<RequisicaoAutenticada>().user!;
});
