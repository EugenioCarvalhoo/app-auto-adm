import { Module } from '@nestjs/common';
import {
  AtualizarRestauranteUseCase,
  CriarRestauranteUseCase,
  DesativarRestauranteUseCase,
  ListarRestaurantesUseCase,
  ObterRestauranteUseCase
} from './application/casos-de-uso';
import { RESTAURANTES_REPOSITORY } from './application/portas';
import { PgRestaurantesRepository } from './infrastructure/pg-restaurantes.repository';
import { RestaurantesController } from './presentation/restaurantes.controller';

@Module({
  controllers: [RestaurantesController],
  providers: [
    ListarRestaurantesUseCase,
    ObterRestauranteUseCase,
    CriarRestauranteUseCase,
    AtualizarRestauranteUseCase,
    DesativarRestauranteUseCase,
    { provide: RESTAURANTES_REPOSITORY, useClass: PgRestaurantesRepository }
  ]
})
export class RestaurantesModule {}
