import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import {
  AtualizarUsuarioPermissoesUseCase,
  CriarUsuarioPermissoesUseCase,
  ListarUsuariosPermissoesUseCase,
  RemoverUsuarioUseCase
} from './application/casos-de-uso';
import { USUARIOS_PERMISSOES_REPOSITORY } from './application/portas';
import { PgUsuariosPermissoesRepository } from './infrastructure/pg-usuarios-permissoes.repository';
import { AdminController } from './presentation/admin.controller';

@Module({
  imports: [AuthModule],
  controllers: [AdminController],
  providers: [
    ListarUsuariosPermissoesUseCase,
    CriarUsuarioPermissoesUseCase,
    AtualizarUsuarioPermissoesUseCase,
    RemoverUsuarioUseCase,
    { provide: USUARIOS_PERMISSOES_REPOSITORY, useClass: PgUsuariosPermissoesRepository }
  ]
})
export class AdminModule {}
