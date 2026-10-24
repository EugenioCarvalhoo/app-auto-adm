import { Module } from '@nestjs/common';
import { LoginUseCase, VerificarTokenUseCase } from './application/casos-de-uso';
import { PASSWORD_HASHER, USUARIOS_AUTH_REPOSITORY } from './application/portas';
import { BcryptPasswordHasher, PgUsuariosAuthRepository } from './infrastructure/adaptadores';
import { AuthController } from './presentation/auth.controller';

@Module({
  controllers: [AuthController],
  providers: [
    LoginUseCase,
    VerificarTokenUseCase,
    { provide: USUARIOS_AUTH_REPOSITORY, useClass: PgUsuariosAuthRepository },
    { provide: PASSWORD_HASHER, useClass: BcryptPasswordHasher }
  ],
  exports: [PASSWORD_HASHER]
})
export class AuthModule {}
