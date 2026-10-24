import { Body, Controller, Get, HttpCode, Inject, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../acesso/presentation/auth.guard';
import { UsuarioAtual } from '../../acesso/presentation/usuario.decorator';
import type { AuthUser } from '../../acesso/domain/regras';
import { TratarErros } from '../../shared/presentation/tratar-erros';
import { LoginUseCase, VerificarTokenUseCase } from '../application/casos-de-uso';

interface CorpoLogin {
  username?: string;
  password?: string;
}

// Login em /api/login e /login (proxy que remove o prefixo /api)
@Controller()
export class AuthController {
  constructor(
    @Inject(LoginUseCase) private readonly login: LoginUseCase,
    @Inject(VerificarTokenUseCase) private readonly verificarToken: VerificarTokenUseCase
  ) {}

  @Post(['api/login', 'login'])
  @HttpCode(200)
  @TratarErros({ mensagem500: 'Erro ao fazer login', log: 'Erro no login:', detalhes: true })
  entrar(@Body() body: CorpoLogin) {
    const { username, password } = body;
    return this.login.executar(username as string, password as string);
  }

  @Get('api/verify')
  @UseGuards(AuthGuard)
  @TratarErros({ mensagem500: 'Erro ao verificar token', log: 'Erro ao verificar token:' })
  verificar(@UsuarioAtual() usuario: AuthUser) {
    return this.verificarToken.executar(usuario.id);
  }
}
