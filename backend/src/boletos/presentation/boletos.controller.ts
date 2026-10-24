import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post, Put, Query, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { AuthGuard } from '../../acesso/presentation/auth.guard';
import { ModuloBoletosGuard } from '../../acesso/presentation/modulo-boletos.guard';
import { UsuarioAtual } from '../../acesso/presentation/usuario.decorator';
import type { AuthUser } from '../../acesso/domain/regras';
import { TratarErros } from '../../shared/presentation/tratar-erros';
import {
  AtualizarBoletoUseCase,
  CriarBoletoUseCase,
  ExcluirBoletoUseCase,
  ListarBoletosUseCase,
  ResumoBoletosUseCase
} from '../application/boletos.casos-de-uso';
import { ExtrairBoletoUseCase } from '../application/extrair-boleto.caso-de-uso';
import { ImagemUploadInterceptor } from './imagem-upload.interceptor';
import {
  AtualizarMetaUseCase,
  ExcluirMetaUseCase,
  ListarMetasUseCase,
  SalvarMetaUseCase
} from '../application/metas.casos-de-uso';

type Corpo = Record<string, unknown> | undefined;

// Erro 42703 (coluna ausente): módulo de boletos sem a migração 014.
const SEM_MIGRACAO_014 = {
  codigo: 'INDISPONIVEL',
  mensagem: 'Módulo de boletos não instalado. Rode a migração 014.'
} as const;
const META_DUPLICADA = { codigo: 'CONFLITO', mensagem: 'Já existe meta para esta semana.' } as const;

@Controller('api/boletos')
@UseGuards(AuthGuard, ModuloBoletosGuard)
export class BoletosController {
  constructor(
    @Inject(ResumoBoletosUseCase) private readonly resumo: ResumoBoletosUseCase,
    @Inject(ListarBoletosUseCase) private readonly listar: ListarBoletosUseCase,
    @Inject(CriarBoletoUseCase) private readonly criar: CriarBoletoUseCase,
    @Inject(AtualizarBoletoUseCase) private readonly atualizar: AtualizarBoletoUseCase,
    @Inject(ExcluirBoletoUseCase) private readonly excluir: ExcluirBoletoUseCase,
    @Inject(ListarMetasUseCase) private readonly listarMetas: ListarMetasUseCase,
    @Inject(SalvarMetaUseCase) private readonly salvarMeta: SalvarMetaUseCase,
    @Inject(AtualizarMetaUseCase) private readonly atualizarMeta: AtualizarMetaUseCase,
    @Inject(ExcluirMetaUseCase) private readonly excluirMeta: ExcluirMetaUseCase,
    @Inject(ExtrairBoletoUseCase) private readonly extrair: ExtrairBoletoUseCase
  ) {}

  // ========== Boletos e notas ==========

  @Get('resumo')
  @TratarErros({
    mensagem500: 'Erro ao calcular o total da semana',
    log: 'Erro ao resumir boletos:',
    mapa: { '42703': SEM_MIGRACAO_014 }
  })
  resumir(@UsuarioAtual() u: AuthUser, @Query('restaurante_id') restauranteId: unknown) {
    return this.resumo.executar(u.id, restauranteId);
  }

  @Get()
  @TratarErros({
    mensagem500: 'Erro ao listar boletos e notas',
    log: 'Erro ao listar boletos:',
    mapa: { '42703': SEM_MIGRACAO_014 }
  })
  listarTodos(@UsuarioAtual() u: AuthUser, @Query('restaurante_id') restauranteId: unknown) {
    return this.listar.executar(u.id, restauranteId);
  }

  @Post()
  @TratarErros({
    mensagem500: 'Erro ao cadastrar boleto ou nota',
    log: 'Erro ao criar boleto:',
    mapa: { '42703': SEM_MIGRACAO_014 }
  })
  cadastrar(@UsuarioAtual() u: AuthUser, @Body() body: Corpo) {
    return this.criar.executar(u.id, body || {});
  }

  /** Leitura por IA: devolve a sugestão e NÃO grava nada. multipart: restaurante_id + imagem. */
  @Post('extrair')
  @HttpCode(200)
  @UseInterceptors(ImagemUploadInterceptor)
  @TratarErros({
    mensagem500: 'Erro ao ler a imagem do boleto',
    log: 'Erro ao extrair boleto:',
    mapa: { '42703': SEM_MIGRACAO_014 }
  })
  extrairDaImagem(
    @UsuarioAtual() u: AuthUser,
    @Body() body: Corpo,
    @UploadedFile() arquivo: { buffer?: Buffer } | undefined
  ) {
    return this.extrair.executar(u.id, body?.restaurante_id, arquivo?.buffer);
  }

  // ========== Metas (rotas fixas antes das com :id) ==========

  @Get('metas')
  @TratarErros({
    mensagem500: 'Erro ao listar metas de gasto',
    log: 'Erro ao listar metas:',
    mapa: { '42703': SEM_MIGRACAO_014 }
  })
  listarDasMetas(@UsuarioAtual() u: AuthUser, @Query('restaurante_id') restauranteId: unknown) {
    return this.listarMetas.executar(u.id, restauranteId);
  }

  @Post('metas')
  @TratarErros({
    mensagem500: 'Erro ao salvar meta de gasto',
    log: 'Erro ao salvar meta:',
    mapa: { '42703': SEM_MIGRACAO_014 }
  })
  salvarDaMeta(@UsuarioAtual() u: AuthUser, @Body() body: Corpo) {
    return this.salvarMeta.executar(u.id, body || {});
  }

  @Put('metas/:id')
  @TratarErros({
    mensagem500: 'Erro ao atualizar meta de gasto',
    log: 'Erro ao atualizar meta:',
    mapa: { '23505': META_DUPLICADA, '42703': SEM_MIGRACAO_014 }
  })
  editarMeta(@UsuarioAtual() u: AuthUser, @Param('id') id: string, @Body() body: Corpo) {
    return this.atualizarMeta.executar(u.id, id, body || {});
  }

  @Delete('metas/:id')
  @TratarErros({
    mensagem500: 'Erro ao remover meta de gasto',
    log: 'Erro ao remover meta:',
    mapa: { '42703': SEM_MIGRACAO_014 }
  })
  removerMeta(@UsuarioAtual() u: AuthUser, @Param('id') id: string) {
    return this.excluirMeta.executar(u.id, id);
  }

  // ========== Boletos com :id ==========

  @Put(':id')
  @TratarErros({
    mensagem500: 'Erro ao atualizar boleto ou nota',
    log: 'Erro ao atualizar boleto:',
    mapa: { '42703': SEM_MIGRACAO_014 }
  })
  editar(@UsuarioAtual() u: AuthUser, @Param('id') id: string, @Body() body: Corpo) {
    return this.atualizar.executar(u.id, id, body || {});
  }

  @Delete(':id')
  @TratarErros({
    mensagem500: 'Erro ao remover boleto ou nota',
    log: 'Erro ao remover boleto:',
    mapa: { '42703': SEM_MIGRACAO_014 }
  })
  remover(@UsuarioAtual() u: AuthUser, @Param('id') id: string) {
    return this.excluir.executar(u.id, id);
  }
}
