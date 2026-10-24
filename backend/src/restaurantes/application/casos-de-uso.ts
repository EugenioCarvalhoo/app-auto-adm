import { Inject, Injectable } from '@nestjs/common';
import { ControleAcesso } from '../../acesso/application/controle-acesso';
import { usuarioRestaurantesRestritos } from '../../acesso/domain/regras';
import { ErroAplicacao } from '../../shared/domain/erros';
import { normalizarRestaurante } from '../domain/restaurante';
import type { EntradaRestaurante, Restaurante } from '../domain/restaurante';
import { RESTAURANTES_REPOSITORY } from './portas';
import type { RestaurantesRepository } from './portas';

@Injectable()
export class ListarRestaurantesUseCase {
  constructor(
    @Inject(RESTAURANTES_REPOSITORY) private readonly repo: RestaurantesRepository,
    @Inject(ControleAcesso) private readonly acesso: ControleAcesso
  ) {}

  async executar(userId: number): Promise<Restaurante[]> {
    const flags = await this.acesso.carregarFlags(userId);
    if (!flags) throw new ErroAplicacao('PROIBIDO', 'Usuário inválido.');
    if (usuarioRestaurantesRestritos(flags)) return this.repo.listarAtivosDoUsuario(userId);
    return this.repo.listarAtivos();
  }
}

@Injectable()
export class ObterRestauranteUseCase {
  constructor(
    @Inject(RESTAURANTES_REPOSITORY) private readonly repo: RestaurantesRepository,
    @Inject(ControleAcesso) private readonly acesso: ControleAcesso
  ) {}

  async executar(userId: number, id: string): Promise<Restaurante> {
    const rid = parseInt(id, 10);
    const flags = await this.acesso.carregarFlags(userId);
    if (flags && usuarioRestaurantesRestritos(flags)) {
      const ok = await this.acesso.usuarioPodeRestaurante(userId, rid);
      if (!ok) throw new ErroAplicacao('PROIBIDO', 'Sem acesso a este restaurante.');
    }
    const restaurante = await this.repo.buscarPorId(id);
    if (!restaurante) throw new ErroAplicacao('NAO_ENCONTRADO', 'Restaurante não encontrado');
    return restaurante;
  }
}

@Injectable()
export class CriarRestauranteUseCase {
  constructor(@Inject(RESTAURANTES_REPOSITORY) private readonly repo: RestaurantesRepository) {}

  async executar(entrada: EntradaRestaurante): Promise<Restaurante> {
    const dados = normalizarRestaurante(entrada);
    if (!dados) throw new ErroAplicacao('VALIDACAO', 'Nome é obrigatório');
    return this.repo.criar(dados);
  }
}

@Injectable()
export class AtualizarRestauranteUseCase {
  constructor(@Inject(RESTAURANTES_REPOSITORY) private readonly repo: RestaurantesRepository) {}

  async executar(id: string, entrada: EntradaRestaurante): Promise<Restaurante> {
    const dados = normalizarRestaurante(entrada);
    if (!dados) throw new ErroAplicacao('VALIDACAO', 'Nome é obrigatório');
    const atualizado = await this.repo.atualizar(id, dados, entrada.ativo);
    if (!atualizado) throw new ErroAplicacao('NAO_ENCONTRADO', 'Restaurante não encontrado');
    return atualizado;
  }
}

@Injectable()
export class DesativarRestauranteUseCase {
  constructor(@Inject(RESTAURANTES_REPOSITORY) private readonly repo: RestaurantesRepository) {}

  /** Soft delete: marca como inativo. */
  async executar(id: string): Promise<{ message: string }> {
    const ok = await this.repo.desativar(id);
    if (!ok) throw new ErroAplicacao('NAO_ENCONTRADO', 'Restaurante não encontrado');
    return { message: 'Restaurante desativado com sucesso' };
  }
}
