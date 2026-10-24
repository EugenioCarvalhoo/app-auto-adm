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
import { ExtrairBoletoUseCase } from './application/extrair-boleto.caso-de-uso';
import { EXTRACAO_CONFIG, EXTRATOR_BOLETO, LIMITE_DIARIO } from './application/extracao.portas';
import { GeminiExtrator } from './infrastructure/gemini-extrator';
import { PgLimiteDiarioRepository } from './infrastructure/pg-limite-diario.repository';
import { BOLETOS_REPOSITORY, METAS_REPOSITORY } from './application/portas';
import { PgBoletosRepository, PgMetasRepository } from './infrastructure/pg-boletos.repository';
import { BoletosController } from './presentation/boletos.controller';

import { ImagemUploadInterceptor } from './presentation/imagem-upload.interceptor';

const LIMITE_DIARIO_PADRAO = 30;

/** EXTRAIR_LIMITE_DIARIO (padrão 30); 0 bloqueia todas as leituras; valor inválido volta ao padrão. */
export function limiteDiarioDoAmbiente(): number {
  const raw = process.env.EXTRAIR_LIMITE_DIARIO;
  if (raw === undefined || raw.trim() === '') return LIMITE_DIARIO_PADRAO;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : LIMITE_DIARIO_PADRAO;
}

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
    ExtrairBoletoUseCase,
    ImagemUploadInterceptor,
    { provide: EXTRATOR_BOLETO, useClass: GeminiExtrator },
    { provide: LIMITE_DIARIO, useClass: PgLimiteDiarioRepository },
    { provide: EXTRACAO_CONFIG, useFactory: () => ({ limiteDiario: limiteDiarioDoAmbiente() }) },
    { provide: BOLETOS_REPOSITORY, useClass: PgBoletosRepository },
    { provide: METAS_REPOSITORY, useClass: PgMetasRepository }
  ]
})
export class BoletosModule {}
