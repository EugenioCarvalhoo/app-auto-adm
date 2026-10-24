import { Inject, Injectable } from '@nestjs/common';
import { ControleAcesso } from '../../acesso/application/controle-acesso';
import { ErroAplicacao } from '../../shared/domain/erros';
import {
  dateToIso,
  enriquecerBoleto,
  hojeBrasil,
  montarResumoSemanal,
  parseDateOnly,
  parseValorBoleto,
  podeExcluirLancamento
} from '../domain/boleto';
import type { BoletoEnriquecido } from '../domain/boleto';
import { normalizarTipo } from '../domain/boletosSemana';
import { BOLETOS_REPOSITORY, METAS_REPOSITORY } from './portas';
import type { BoletosRepository, MetasRepository } from './portas';

type Corpo = Record<string, unknown>;

/** restaurante_id obrigatório e numérico (400 caso contrário). */
export function exigirRestauranteId(raw: unknown): number {
  const rid = parseInt(String(raw), 10);
  if (Number.isNaN(rid)) throw new ErroAplicacao('VALIDACAO', 'restaurante_id é obrigatório');
  return rid;
}

/** id de URL numérico (400 'id inválido' caso contrário). */
export function exigirId(raw: string): number {
  const id = parseInt(raw, 10);
  if (Number.isNaN(id)) throw new ErroAplicacao('VALIDACAO', 'id inválido');
  return id;
}

@Injectable()
export class ResumoBoletosUseCase {
  constructor(
    @Inject(BOLETOS_REPOSITORY) private readonly boletos: BoletosRepository,
    @Inject(METAS_REPOSITORY) private readonly metas: MetasRepository,
    @Inject(ControleAcesso) private readonly acesso: ControleAcesso
  ) {}

  async executar(userId: number, restauranteIdRaw: unknown) {
    const rid = exigirRestauranteId(restauranteIdRaw);
    await this.acesso.exigirAcessoBoletosRestaurante(userId, rid);
    const [boletos, metas] = await Promise.all([
      this.boletos.listarPorRecebimentoAsc(rid),
      this.metas.listarPorSemanaAsc(rid)
    ]);
    return montarResumoSemanal(boletos, metas);
  }
}

@Injectable()
export class ListarBoletosUseCase {
  constructor(
    @Inject(BOLETOS_REPOSITORY) private readonly boletos: BoletosRepository,
    @Inject(ControleAcesso) private readonly acesso: ControleAcesso
  ) {}

  async executar(userId: number, restauranteIdRaw: unknown): Promise<BoletoEnriquecido[]> {
    const rid = exigirRestauranteId(restauranteIdRaw);
    await this.acesso.exigirAcessoBoletosRestaurante(userId, rid);
    const rows = await this.boletos.listarPorRestaurante(rid);
    return rows.map(enriquecerBoleto);
  }
}

@Injectable()
export class CriarBoletoUseCase {
  constructor(
    @Inject(BOLETOS_REPOSITORY) private readonly boletos: BoletosRepository,
    @Inject(ControleAcesso) private readonly acesso: ControleAcesso
  ) {}

  async executar(userId: number, body: Corpo): Promise<BoletoEnriquecido> {
    const rid = exigirRestauranteId(body.restaurante_id);
    await this.acesso.exigirAcessoBoletosRestaurante(userId, rid);

    const descricao = body.descricao != null ? String(body.descricao).trim() : '';
    if (!descricao) throw new ErroAplicacao('VALIDACAO', 'Descrição é obrigatória');
    const valor = parseValorBoleto(body.valor);
    if (valor == null) throw new ErroAplicacao('VALIDACAO', 'Valor inválido');
    const tipo = normalizarTipo(body.tipo);
    let dtRecebimento = body.dt_recebimento ? parseDateOnly(String(body.dt_recebimento).slice(0, 10)) : null;
    if (tipo === 'Sem Boleto' && !dtRecebimento) {
      dtRecebimento = hojeBrasil();
    }
    if (!dtRecebimento) throw new ErroAplicacao('VALIDACAO', 'Data de recebimento é obrigatória');
    let dtVencimento: string | null = null;
    if (tipo === 'Boleto') {
      dtVencimento = body.dt_vencimento ? parseDateOnly(String(body.dt_vencimento).slice(0, 10)) : null;
      if (!dtVencimento) throw new ErroAplicacao('VALIDACAO', 'Data de vencimento é obrigatória para boleto');
    }

    const criado = await this.boletos.inserir({
      restauranteId: rid,
      usuarioId: userId,
      dtRecebimento,
      dtVencimento,
      descricao,
      valor,
      tipo
    });
    return enriquecerBoleto(criado);
  }
}

@Injectable()
export class AtualizarBoletoUseCase {
  constructor(
    @Inject(BOLETOS_REPOSITORY) private readonly boletos: BoletosRepository,
    @Inject(ControleAcesso) private readonly acesso: ControleAcesso
  ) {}

  async executar(userId: number, idRaw: string, body: Corpo): Promise<BoletoEnriquecido> {
    const id = exigirId(idRaw);
    const atual = await this.boletos.buscarPorId(id);
    if (!atual) throw new ErroAplicacao('NAO_ENCONTRADO', 'Lançamento não encontrado');
    // valida o restaurante do REGISTRO, não o que veio na requisição
    await this.acesso.exigirAcessoBoletosRestaurante(userId, atual.restaurante_id);

    const descricao = body.descricao !== undefined ? String(body.descricao).trim() : atual.descricao;
    if (!descricao) throw new ErroAplicacao('VALIDACAO', 'Descrição é obrigatória');
    const valor = body.valor !== undefined ? parseValorBoleto(body.valor) : Number(atual.valor);
    if (valor == null) throw new ErroAplicacao('VALIDACAO', 'Valor inválido');
    const tipo = body.tipo !== undefined ? normalizarTipo(body.tipo) : normalizarTipo(atual.tipo);
    let dtRecebimento =
      body.dt_recebimento !== undefined
        ? parseDateOnly(String(body.dt_recebimento || '').slice(0, 10))
        : dateToIso(atual.dt_recebimento);
    if (tipo === 'Sem Boleto' && !dtRecebimento) {
      dtRecebimento = hojeBrasil();
    }
    if (!dtRecebimento) throw new ErroAplicacao('VALIDACAO', 'Data de recebimento é obrigatória');
    let dtVencimento = dateToIso(atual.dt_vencimento);
    if (tipo === 'Sem Boleto') {
      dtVencimento = null;
    } else if (body.dt_vencimento !== undefined) {
      dtVencimento = body.dt_vencimento ? parseDateOnly(String(body.dt_vencimento).slice(0, 10)) : null;
    }
    if (tipo === 'Boleto' && !dtVencimento) {
      throw new ErroAplicacao('VALIDACAO', 'Data de vencimento é obrigatória para boleto');
    }

    const atualizado = await this.boletos.atualizar(id, { dtRecebimento, dtVencimento, descricao, valor, tipo });
    return enriquecerBoleto(atualizado);
  }
}

@Injectable()
export class ExcluirBoletoUseCase {
  constructor(
    @Inject(BOLETOS_REPOSITORY) private readonly boletos: BoletosRepository,
    @Inject(ControleAcesso) private readonly acesso: ControleAcesso
  ) {}

  async executar(userId: number, idRaw: string): Promise<{ message: string; id: number }> {
    const id = exigirId(idRaw);
    const existente = await this.boletos.buscarParaExclusao(id);
    if (!existente) throw new ErroAplicacao('NAO_ENCONTRADO', 'Lançamento não encontrado');
    await this.acesso.exigirAcessoBoletosRestaurante(userId, existente.restaurante_id);
    const flags = await this.acesso.carregarFlags(userId);
    if (!podeExcluirLancamento(!!flags && flags.is_admin, existente.created_at, Date.now())) {
      throw new ErroAplicacao('PROIBIDO', 'Só o administrador pode excluir um lançamento com mais de 1 dia.');
    }
    await this.boletos.excluir(id);
    return { message: 'Lançamento removido', id };
  }
}
