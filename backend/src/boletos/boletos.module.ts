import { Module } from '@nestjs/common';
import {
  AtualizarBoletoUseCase,
  CriarBoletoUseCase,
  ExcluirBoletoUseCase,
  ListarBoletosUseCase,
  ResumoBoletosUseCase
} from './application/boletos.casos-de-uso';
import {
  AtualizarMetaUseCase,
  ExcluirMetaUseCase,
  ListarMetasUseCase,
  SalvarMetaUseCase
} from './application/metas.casos-de-uso';
import { BOLETOS_REPOSITORY, METAS_REPOSITORY } from './application/portas';
import { PgBoletosRepository, PgMetasRepository } from './infrastructure/pg-boletos.repository';
import { BoletosController } from './presentation/boletos.controller';

@Module({
  controllers: [BoletosController],
  providers: [
    ResumoBoletosUseCase,
    ListarBoletosUseCase,
    CriarBoletoUseCase,
    AtualizarBoletoUseCase,
    ExcluirBoletoUseCase,
    ListarMetasUseCase,
    SalvarMetaUseCase,
    AtualizarMetaUseCase,
    ExcluirMetaUseCase,
    { provide: BOLETOS_REPOSITORY, useClass: PgBoletosRepository },
    { provide: METAS_REPOSITORY, useClass: PgMetasRepository }
  ]
})
export class BoletosModule {}
