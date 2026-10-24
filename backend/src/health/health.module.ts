import { Module } from '@nestjs/common';
import { LivenessUseCase, ProntidaoUseCase } from './application/casos-de-uso';
import { MIGRACOES_PENDENTES, SAUDE_BANCO } from './application/portas';
import { PgMigracoesPendentes, PgSaudeBanco } from './infrastructure/pg-saude';
import { HealthController } from './presentation/health.controller';

@Module({
  controllers: [HealthController],
  providers: [
    LivenessUseCase,
    ProntidaoUseCase,
    { provide: SAUDE_BANCO, useClass: PgSaudeBanco },
    { provide: MIGRACOES_PENDENTES, useClass: PgMigracoesPendentes }
  ]
})
export class HealthModule {}
