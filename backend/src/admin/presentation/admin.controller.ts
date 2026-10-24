import { Body, Controller, Delete, Get, Inject, Param, Post, Put, UseGuards } from '@nestjs/common';
import { AdminGuard } from '../../acesso/presentation/admin.guard';
import { AuthGuard } from '../../acesso/presentation/auth.guard';
import { UsuarioAtual } from '../../acesso/presentation/usuario.decorator';
import type { AuthUser } from '../../acesso/domain/regras';
import { TratarErros } from '../../shared/presentation/tratar-erros';
import {
  AtualizarUsuarioPermissoesUseCase,
  CriarUsuarioPermissoesUseCase,
  ListarUsuariosPermissoesUseCase,
  RemoverUsuarioUseCase
} from '../application/casos-de-uso';

const MIGRACAO_014 = { codigo: 'INDISPONIVEL', mensagem: 'Migração de permissões pendente (014).' } as const;

@Controller('api/admin/usuarios-permissoes')
@UseGuards(AuthGuard, AdminGuard)
export class AdminController {
  constructor(
    @Inject(ListarUsuariosPermissoesUseCase) private readonly listar: ListarUsuariosPermissoesUseCase,
    @Inject(CriarUsuarioPermissoesUseCase) private readonly criar: CriarUsuarioPermissoesUseCase,
    @Inject(AtualizarUsuarioPermissoesUseCase) private readonly atualizar: AtualizarUsuarioPermissoesUseCase,
    @Inject(RemoverUsuarioUseCase) private readonly remover: RemoverUsuarioUseCase
  ) {}

  @Get()
  @TratarErros({
    mensagem500: 'Erro ao listar permissões de usuários',
    log: 'Erro ao listar permissões:',
    mapa: { '42703': MIGRACAO_014 }
  })
  listarTodos() {
    return this.listar.executar();
  }

  @Post()
  @TratarErros({
    mensagem500: 'Erro ao criar usuário',
    mapa: {
      '42703': MIGRACAO_014,
      '23505': { codigo: 'CONFLITO', mensagem: 'Já existe usuário com este login.' }
    }
  })
  cadastrar(@Body() body: Record<string, unknown> | undefined) {
    return this.criar.executar(body || {});
  }

  @Put(':id')
  @TratarErros({
    mensagem500: 'Erro ao atualizar permissões',
    log: 'Erro ao atualizar permissões:',
    mapa: { '42703': MIGRACAO_014 }
  })
  editar(@Param('id') id: string, @Body() body: Record<string, unknown> | undefined) {
    return this.atualizar.executar(id, body || {});
  }

  @Delete(':id')
  @TratarErros({
    mensagem500: 'Erro ao remover usuário',
    mapa: {
      '23503': {
        codigo: 'CONFLITO',
        mensagem: 'Este usuário ainda está ligado a outros registros e não pode ser removido.'
      }
    }
  })
  excluir(@UsuarioAtual() usuario: AuthUser, @Param('id') id: string) {
    return this.remover.executar(id, usuario.id);
  }
}
