import type { Request } from 'express';
import type { AuthUser } from '../domain/regras';

/** Request do Express com o usuário do JWT preenchido pelo AuthGuard. */
export type RequisicaoAutenticada = Request & { user?: AuthUser };
