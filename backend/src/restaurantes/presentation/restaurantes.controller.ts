import { Body, Controller, Delete, Get, Inject, Param, Post, Put, UseGuards } from '@nestjs/common';
import { AdminGuard } from '../../acesso/presentation/admin.guard';
import { AuthGuard } from '../../acesso/presentation/auth.guard';
import { UsuarioAtual } from '../../acesso/presentation/usuario.decorator';
import type { AuthUser } from '../../acesso/domain/regras';
import { TratarErros } from '../../shared/presentation/tratar-erros';
import {
  AtualizarRestauranteUseCase,
  CriarRestauranteUseCase,
  DesativarRestauranteUseCase,
  ListarRestaurantesUseCase,
  ObterRestauranteUseCase
} from '../application/casos-de-uso';
import type { EntradaRestaurante } from '../domain/restaurante';

@Controller('api/restaurantes')
@UseGuards(AuthGuard)
export class RestaurantesController {
  constructor(
    @Inject(ListarRestaurantesUseCase) private readonly listar: ListarRestaurantesUseCase,
    @Inject(ObterRestauranteUseCase) private readonly obter: ObterRestauranteUseCase,
    @Inject(CriarRestauranteUseCase) private readonly criar: CriarRestauranteUseCase,
    @Inject(AtualizarRestauranteUseCase) private readonly atualizar: AtualizarRestauranteUseCase,
    @Inject(DesativarRestauranteUseCase) private readonly desativar: DesativarRestauranteUseCase
  ) {}

  @Get()
  @TratarErros({ mensagem500: 'Erro ao buscar restaurantes' })
  listarTodos(@UsuarioAtual() usuario: AuthUser) {
    return this.listar.executar(usuario.id);
  }

  @Get(':id')
  @TratarErros({ mensagem500: 'Erro ao buscar restaurante' })
  buscar(@UsuarioAtual() usuario: AuthUser, @Param('id') id: string) {
    return this.obter.executar(usuario.id, id);
  }

  @Post()
  @UseGuards(AdminGuard)
  @TratarErros({ mensagem500: 'Erro ao criar restaurante' })
  cadastrar(@Body() body: EntradaRestaurante) {
    return this.criar.executar(body);
  }

  @Put(':id')
  @UseGuards(AdminGuard)
  @TratarErros({ mensagem500: 'Erro ao atualizar restaurante' })
  editar(@Param('id') id: string, @Body() body: EntradaRestaurante) {
    return this.atualizar.executar(id, body);
  }

  @Delete(':id')
  @UseGuards(AdminGuard)
  @TratarErros({ mensagem500: 'Erro ao deletar restaurante', log: 'Erro ao deletar restaurante:' })
  remover(@Param('id') id: string) {
    return this.desativar.executar(id);
  }
}
