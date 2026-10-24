import { Global, Module } from '@nestjs/common';
import { ControleAcesso } from './application/controle-acesso';
import { ACESSO_REPOSITORY, TOKEN_SERVICE } from './application/portas';
import { JwtTokenService } from './infrastructure/jwt-token.service';
import { PgAcessoRepository } from './infrastructure/pg-acesso.repository';
import { AdminGuard } from './presentation/admin.guard';
import { AuthGuard } from './presentation/auth.guard';
import { ModuloBoletosGuard } from './presentation/modulo-boletos.guard';

@Global()
@Module({
  providers: [
    ControleAcesso,
    { provide: ACESSO_REPOSITORY, useClass: PgAcessoRepository },
    { provide: TOKEN_SERVICE, useClass: JwtTokenService },
    AuthGuard,
    AdminGuard,
    ModuloBoletosGuard
  ],
  exports: [ControleAcesso, ACESSO_REPOSITORY, TOKEN_SERVICE, AuthGuard, AdminGuard, ModuloBoletosGuard]
})
export class AcessoModule {}
