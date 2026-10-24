import type { DadosRestaurante, Restaurante } from '../domain/restaurante';

export const RESTAURANTES_REPOSITORY = Symbol('RestaurantesRepository');

export interface RestaurantesRepository {
  listarAtivos(): Promise<Restaurante[]>;
  listarAtivosDoUsuario(userId: number): Promise<Restaurante[]>;
  /** `id` cru da URL (a consulta aceita texto e o banco rejeita o que não for inteiro). */
  buscarPorId(id: string): Promise<Restaurante | null>;
  criar(dados: DadosRestaurante): Promise<Restaurante>;
  atualizar(id: string, dados: DadosRestaurante, ativo: unknown): Promise<Restaurante | null>;
  desativar(id: string): Promise<boolean>;
}
