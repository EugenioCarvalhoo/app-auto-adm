import { Inject, Injectable } from '@nestjs/common';
import { ControleAcesso } from '../../acesso/application/controle-acesso';
import { TOKEN_SERVICE } from '../../acesso/application/portas';
import type { TokenService } from '../../acesso/application/portas';
import type { UserClient } from '../../acesso/domain/regras';
import { ErroAplicacao } from '../../shared/domain/erros';
import { PASSWORD_HASHER, USUARIOS_AUTH_REPOSITORY } from './portas';
import type { PasswordHasher, UsuariosAuthRepository } from './portas';

@Injectable()
export class LoginUseCase {
  constructor(
    @Inject(USUARIOS_AUTH_REPOSITORY) private readonly usuarios: UsuariosAuthRepository,
    @Inject(PASSWORD_HASHER) private readonly hasher: PasswordHasher,
    @Inject(TOKEN_SERVICE) private readonly tokens: TokenService,
    @Inject(ControleAcesso) private readonly acesso: ControleAcesso
  ) {}

  async executar(username: string, password: string): Promise<{ token: string; user: UserClient }> {
    console.log('Tentativa de login recebida');

    if (!username || !password) {
      throw new ErroAplicacao('VALIDACAO', 'Username e senha são obrigatórios');
    }

    console.log('Buscando usuário:', username);
    const user = await this.usuarios.buscarPorUsername(username);
    if (!user) {
      console.log('Usuário não encontrado');
      throw new ErroAplicacao('NAO_AUTENTICADO', 'Credenciais inválidas');
    }
    console.log('Usuário encontrado, verificando senha...');

    const senhaValida = await this.hasher.comparar(password, user.password);
    if (!senhaValida) {
      console.log('Senha inválida');
      throw new ErroAplicacao('NAO_AUTENTICADO', 'Credenciais inválidas');
    }

    console.log('Senha válida, gerando token...');
    const shaped = await this.acesso.montarUsuarioCliente(user);
    if (!shaped) {
      throw new ErroAplicacao('INTERNO', 'Erro ao carregar perfil do usuário.');
    }
    const token = this.tokens.assinar(
      {
        id: user.id,
        username: user.username,
        is_admin: shaped.is_admin,
        modulo_boletos: shaped.modulo_boletos
      },
      '24h'
    );

    console.log('Login bem-sucedido para:', username);
    return { token, user: shaped };
  }
}

@Injectable()
export class VerificarTokenUseCase {
  constructor(
    @Inject(USUARIOS_AUTH_REPOSITORY) private readonly usuarios: UsuariosAuthRepository,
    @Inject(ControleAcesso) private readonly acesso: ControleAcesso
  ) {}

  async executar(userId: number): Promise<{ user: UserClient }> {
    const usuario = await this.usuarios.buscarPorId(userId);
    if (!usuario) {
      throw new ErroAplicacao('NAO_ENCONTRADO', 'Usuário não encontrado');
    }
    const shaped = await this.acesso.montarUsuarioCliente(usuario);
    if (!shaped) {
      throw new ErroAplicacao('NAO_ENCONTRADO', 'Usuário não encontrado');
    }
    return { user: shaped };
  }
}
