import { Inject, Injectable } from '@nestjs/common';
import { ControleAcesso } from '../../acesso/application/controle-acesso';
import { ErroAplicacao } from '../../shared/domain/erros';
import { dateToIso, enriquecerMeta, parseDateOnly, parseValorBoleto } from '../domain/boleto';
import type { MetaEnriquecida } from '../domain/boleto';
import { intervaloSemana } from '../domain/boletosSemana';
import type { IntervaloSemana } from '../domain/boletosSemana';
import { exigirId, exigirRestauranteId } from './boletos.casos-de-uso';
import { METAS_REPOSITORY } from './portas';
import type { MetasRepository } from './portas';

type Corpo = Record<string, unknown>;

@Injectable()
export class ListarMetasUseCase {
  constructor(
    @Inject(METAS_REPOSITORY) private readonly metas: MetasRepository,
    @Inject(ControleAcesso) private readonly acesso: ControleAcesso
  ) {}

  async executar(userId: number, restauranteIdRaw: unknown): Promise<MetaEnriquecida[]> {
    const rid = exigirRestauranteId(restauranteIdRaw);
    await this.acesso.exigirAcessoBoletosRestaurante(userId, rid);
    const rows = await this.metas.listarPorSemanaDesc(rid);
    return rows.map(enriquecerMeta);
  }
}

@Injectable()
export class SalvarMetaUseCase {
  constructor(
    @Inject(METAS_REPOSITORY) private readonly metas: MetasRepository,
    @Inject(ControleAcesso) private readonly acesso: ControleAcesso
  ) {}

  async executar(userId: number, body: Corpo): Promise<MetaEnriquecida> {
    const rid = exigirRestauranteId(body.restaurante_id);
    await this.acesso.exigirAcessoBoletosRestaurante(userId, rid);
    const dataReferencia = parseDateOnly(String(body.data_referencia || '').slice(0, 10));
    if (!dataReferencia) throw new ErroAplicacao('VALIDACAO', 'Informe uma data dentro da semana da meta');
    const maximo = parseValorBoleto(body.maximo_gasto);
    if (maximo == null) throw new ErroAplicacao('VALIDACAO', 'Máximo de gasto inválido');
    const semana = intervaloSemana(dataReferencia) as IntervaloSemana; // dataReferencia já validada
    const row = await this.metas.salvar(rid, {
      dataReferencia,
      semanaChave: semana.chave,
      semanaInicio: semana.inicio,
      semanaFim: semana.fim,
      maximoGasto: maximo
    });
    return enriquecerMeta(row);
  }
}

@Injectable()
export class AtualizarMetaUseCase {
  constructor(
    @Inject(METAS_REPOSITORY) private readonly metas: MetasRepository,
    @Inject(ControleAcesso) private readonly acesso: ControleAcesso
  ) {}

  async executar(userId: number, idRaw: string, body: Corpo): Promise<MetaEnriquecida> {
    const id = exigirId(idRaw);
    const atual = await this.metas.buscarPorId(id);
    if (!atual) throw new ErroAplicacao('NAO_ENCONTRADO', 'Meta não encontrada');
    // valida o restaurante do REGISTRO, não o que veio na requisição
    await this.acesso.exigirAcessoBoletosRestaurante(userId, atual.restaurante_id);
    const dataReferencia =
      body.data_referencia !== undefined
        ? parseDateOnly(String(body.data_referencia || '').slice(0, 10))
        : dateToIso(atual.data_referencia);
    if (!dataReferencia) throw new ErroAplicacao('VALIDACAO', 'Informe uma data dentro da semana da meta');
    const maximo = body.maximo_gasto !== undefined ? parseValorBoleto(body.maximo_gasto) : Number(atual.maximo_gasto);
    if (maximo == null) throw new ErroAplicacao('VALIDACAO', 'Máximo de gasto inválido');
    const semana = intervaloSemana(dataReferencia) as IntervaloSemana; // dataReferencia já validada
    const row = await this.metas.atualizar(id, {
      dataReferencia,
      semanaChave: semana.chave,
      semanaInicio: semana.inicio,
      semanaFim: semana.fim,
      maximoGasto: maximo
    });
    return enriquecerMeta(row);
  }
}

@Injectable()
export class ExcluirMetaUseCase {
  constructor(
    @Inject(METAS_REPOSITORY) private readonly metas: MetasRepository,
    @Inject(ControleAcesso) private readonly acesso: ControleAcesso
  ) {}

  async executar(userId: number, idRaw: string): Promise<{ message: string; id: number }> {
    const id = exigirId(idRaw);
    const restauranteId = await this.metas.buscarRestauranteId(id);
    if (restauranteId == null) throw new ErroAplicacao('NAO_ENCONTRADO', 'Meta não encontrada');
    await this.acesso.exigirAcessoBoletosRestaurante(userId, restauranteId);
    await this.metas.excluir(id);
    return { message: 'Meta removida', id };
  }
}
