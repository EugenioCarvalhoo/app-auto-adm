import { Inject, Injectable } from '@nestjs/common';
import { ErroAplicacao } from '../../shared/domain/erros';
import { temAcessoModuloBoletos, usuarioRestaurantesRestritos } from '../domain/regras';
import type { UserClient, UserFlags } from '../domain/regras';
import { ACESSO_REPOSITORY } from './portas';
import type { AcessoRepository } from './portas';

export const MSG_SEM_MODULO_BOLETOS = 'Sem permissão para o módulo de boletos e notas.';

/** Regras de autorização que consultam o banco a cada chamada. */
@Injectable()
export class ControleAcesso {
  constructor(@Inject(ACESSO_REPOSITORY) private readonly repo: AcessoRepository) {}

  carregarFlags(userId: number): Promise<UserFlags | null> {
    return this.repo.carregarFlags(userId);
  }

  restauranteIdsDoUsuario(userId: number): Promise<number[]> {
    return this.repo.restauranteIdsDoUsuario(userId);
  }

  usuarioPodeRestaurante(userId: number, restauranteId: number): Promise<boolean> {
    return this.repo.usuarioPodeRestaurante(userId, restauranteId);
  }

  /** Equivale ao antigo requireModuloBoletos. */
  async exigirModuloBoletos(userId: number): Promise<void> {
    const flags = await this.repo.carregarFlags(userId);
    if (!flags) throw new ErroAplicacao('PROIBIDO', 'Usuário inválido.');
    if (!temAcessoModuloBoletos(flags)) throw new ErroAplicacao('PROIBIDO', MSG_SEM_MODULO_BOLETOS);
  }

  /** Equivale ao antigo assertBoletosAcessoRestaurante: módulo liberado e restaurante vinculado (admin dispensa o vínculo). */
  async exigirAcessoBoletosRestaurante(userId: number, restauranteId: unknown): Promise<void> {
    const rid = parseInt(String(restauranteId), 10);
    if (Number.isNaN(rid)) throw new ErroAplicacao('VALIDACAO', 'restaurante_id inválido');
    const flags = await this.repo.carregarFlags(userId);
    if (!flags) throw new ErroAplicacao('PROIBIDO', 'Usuário inválido.');
    if (!temAcessoModuloBoletos(flags)) throw new ErroAplicacao('PROIBIDO', MSG_SEM_MODULO_BOLETOS);
    if (flags.is_admin) return;
    const ok = await this.repo.usuarioPodeRestaurante(userId, rid);
    if (!ok) throw new ErroAplicacao('PROIBIDO', 'Sem permissão para os boletos deste restaurante.');
  }

  /** Equivale ao antigo shapeUserForClient. */
  async montarUsuarioCliente(usuario: { id: number; username: string; nome: string }): Promise<UserClient | null> {
    const flags = await this.repo.carregarFlags(usuario.id);
    if (!flags) return null;
    const restrito = usuarioRestaurantesRestritos(flags);
    return {
      id: usuario.id,
      username: usuario.username,
      nome: usuario.nome,
      is_admin: flags.is_admin,
      modulo_boletos: flags.modulo_boletos,
      restaurante_ids: restrito ? await this.repo.restauranteIdsDoUsuario(usuario.id) : []
    };
  }
}
