import { Inject, Injectable } from '@nestjs/common';
import { PASSWORD_HASHER } from '../../auth/application/portas';
import type { PasswordHasher } from '../../auth/application/portas';
import { ErroAplicacao } from '../../shared/domain/erros';
import { USUARIOS_PERMISSOES_REPOSITORY } from './portas';
import type { UsuariosPermissoesRepository } from './portas';

export interface UsuarioPermissoesCliente {
  id: number;
  username: string;
  nome: string;
  is_admin: boolean;
  modulo_boletos: boolean;
  restaurante_ids: number[];
}

const MSG_RESTAURANTE_OBRIGATORIO = 'Usuário não-admin precisa de ao menos um restaurante liberado.';

/** Ids numéricos válidos do corpo (descarta o que não é número); lista vazia se não for array. */
function parseIds(raw: unknown): number[] {
  return Array.isArray(raw)
    ? raw.map((x: unknown) => parseInt(String(x), 10)).filter((x: number) => !Number.isNaN(x))
    : [];
}

@Injectable()
export class ListarUsuariosPermissoesUseCase {
  constructor(@Inject(USUARIOS_PERMISSOES_REPOSITORY) private readonly repo: UsuariosPermissoesRepository) {}

  async executar(): Promise<UsuarioPermissoesCliente[]> {
    const usuarios = await this.repo.listarTodos();
    const rows: UsuarioPermissoesCliente[] = [];
    for (const row of usuarios) {
      const flags = row.is_admin ? { ...row, modulo_boletos: true } : row;
      const restaurante_ids = await this.repo.restauranteIdsDoUsuario(row.id);
      rows.push({
        id: flags.id,
        username: flags.username,
        nome: flags.nome,
        is_admin: !!flags.is_admin,
        modulo_boletos: !!flags.modulo_boletos,
        restaurante_ids
      });
    }
    return rows;
  }
}

@Injectable()
export class CriarUsuarioPermissoesUseCase {
  constructor(
    @Inject(USUARIOS_PERMISSOES_REPOSITORY) private readonly repo: UsuariosPermissoesRepository,
    @Inject(PASSWORD_HASHER) private readonly hasher: PasswordHasher
  ) {}

  async executar(entrada: Record<string, unknown>): Promise<UsuarioPermissoesCliente> {
    const username = String(entrada.username || '').trim();
    const password = String(entrada.password || '');
    const nome = String(entrada.nome || '').trim();
    if (!username) throw new ErroAplicacao('VALIDACAO', 'Login é obrigatório');
    if (password.length < 4) throw new ErroAplicacao('VALIDACAO', 'Senha é obrigatória (mín. 4 caracteres).');
    if (!nome) throw new ErroAplicacao('VALIDACAO', 'Nome é obrigatório');

    const moduloBoletos = entrada.modulo_boletos === true;
    if (!moduloBoletos) throw new ErroAplicacao('VALIDACAO', 'Marque ao menos um módulo para o usuário.');

    // todo usuário não-admin precisa de restaurantes liberados
    const restauranteIds = parseIds(entrada.restaurante_ids);
    if (restauranteIds.length === 0) throw new ErroAplicacao('VALIDACAO', MSG_RESTAURANTE_OBRIGATORIO);

    return this.repo.comSessao(async (sessao) => {
      if (await sessao.existeUsername(username)) {
        throw new ErroAplicacao('CONFLITO', 'Já existe usuário com este login.');
      }
      const senhaHash = await this.hasher.gerar(password);
      await sessao.iniciarTransacao();
      const usuario = await sessao.inserirUsuario({ username, senhaHash, nome, moduloBoletos });
      const ids = await sessao.sincronizarRestaurantes(usuario.id, restauranteIds);
      if (ids.length === 0) {
        await sessao.desfazer();
        throw new ErroAplicacao('VALIDACAO', 'Nenhum dos restaurantes informados é válido ou está ativo.');
      }
      await sessao.confirmar();
      return {
        id: usuario.id,
        username: usuario.username,
        nome: usuario.nome,
        is_admin: false,
        modulo_boletos: moduloBoletos,
        restaurante_ids: ids
      };
    });
  }
}

@Injectable()
export class AtualizarUsuarioPermissoesUseCase {
  constructor(@Inject(USUARIOS_PERMISSOES_REPOSITORY) private readonly repo: UsuariosPermissoesRepository) {}

  async executar(idBruto: string, entrada: Record<string, unknown>): Promise<UsuarioPermissoesCliente> {
    const userId = parseInt(idBruto, 10);
    if (Number.isNaN(userId)) throw new ErroAplicacao('VALIDACAO', 'id inválido');

    return this.repo.comSessao(async (sessao) => {
      const usuario = await sessao.buscarUsuario(userId);
      if (!usuario) throw new ErroAplicacao('NAO_ENCONTRADO', 'Usuário não encontrado');
      if (usuario.is_admin) {
        throw new ErroAplicacao('VALIDACAO', 'Permissões de administrador não podem ser alteradas.');
      }

      // Revogar o módulo é válido (false), mas omitir o campo não pode revogar sem querer.
      if (typeof entrada.modulo_boletos !== 'boolean') {
        throw new ErroAplicacao('VALIDACAO', 'Informe modulo_boletos (true ou false).');
      }
      const moduloBoletos = entrada.modulo_boletos;

      // todo usuário não-admin precisa de restaurantes liberados
      const restauranteIds = Array.isArray(entrada.restaurante_ids)
        ? parseIds(entrada.restaurante_ids)
        : await sessao.restauranteIdsDoUsuario(userId);
      if (restauranteIds.length === 0) throw new ErroAplicacao('VALIDACAO', MSG_RESTAURANTE_OBRIGATORIO);

      await sessao.iniciarTransacao();
      await sessao.atualizarModuloBoletos(userId, moduloBoletos);
      const finais = await sessao.sincronizarRestaurantes(userId, restauranteIds);
      await sessao.confirmar();
      return {
        id: userId,
        username: usuario.username,
        nome: usuario.nome,
        is_admin: false,
        modulo_boletos: moduloBoletos,
        restaurante_ids: finais
      };
    });
  }
}

@Injectable()
export class RemoverUsuarioUseCase {
  constructor(@Inject(USUARIOS_PERMISSOES_REPOSITORY) private readonly repo: UsuariosPermissoesRepository) {}

  async executar(idBruto: string, solicitanteId: number): Promise<{ message: string; id: number }> {
    const userId = parseInt(idBruto, 10);
    if (Number.isNaN(userId)) throw new ErroAplicacao('VALIDACAO', 'id inválido');
    if (userId === solicitanteId) {
      throw new ErroAplicacao('VALIDACAO', 'Não é possível remover o próprio usuário.');
    }
    const usuario = await this.repo.buscarPorId(userId);
    if (!usuario) throw new ErroAplicacao('NAO_ENCONTRADO', 'Usuário não encontrado');
    if (usuario.is_admin) throw new ErroAplicacao('VALIDACAO', 'Não é possível remover um administrador.');
    await this.repo.remover(userId);
    return { message: 'Usuário removido', id: userId };
  }
}
