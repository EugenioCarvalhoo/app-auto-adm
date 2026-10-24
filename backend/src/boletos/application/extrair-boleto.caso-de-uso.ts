import { Inject, Injectable } from '@nestjs/common';
import { ControleAcesso } from '../../acesso/application/controle-acesso';
import { ErroAplicacao } from '../../shared/domain/erros';
import { hojeBrasil } from '../domain/boleto';
import { detectarMimeImagem, lerJsonDoModelo, sanearExtracao } from '../domain/extracao';
import type { ExtracaoSugerida } from '../domain/extracao';
import { exigirRestauranteId } from './boletos.casos-de-uso';
import {
  ErroExtratorIndisponivel,
  EXTRACAO_CONFIG,
  EXTRATOR_BOLETO,
  LIMITE_DIARIO
} from './extracao.portas';
import type { ExtracaoConfig, ExtratorBoleto, LimiteDiario } from './extracao.portas';

export const MSG_IA_NAO_CONFIGURADA = 'Leitura por IA não configurada';
export const MSG_LIMITE_ATINGIDO = 'Limite diário de leituras por IA atingido';
export const MSG_IA_FALHOU = 'Não foi possível ler a imagem agora. Tente novamente.';

/** Lê a imagem por IA e devolve a sugestão saneada. Não grava boleto nenhum. */
@Injectable()
export class ExtrairBoletoUseCase {
  constructor(
    @Inject(EXTRATOR_BOLETO) private readonly extrator: ExtratorBoleto,
    @Inject(LIMITE_DIARIO) private readonly limite: LimiteDiario,
    @Inject(EXTRACAO_CONFIG) private readonly config: ExtracaoConfig,
    @Inject(ControleAcesso) private readonly acesso: ControleAcesso
  ) {}

  async executar(userId: number, restauranteIdRaw: unknown, imagem: Buffer | undefined): Promise<ExtracaoSugerida> {
    const rid = exigirRestauranteId(restauranteIdRaw);
    // 403 antes de qualquer gasto de limite ou de IA.
    await this.acesso.exigirAcessoBoletosRestaurante(userId, rid);

    if (!imagem || imagem.length === 0) throw new ErroAplicacao('VALIDACAO', 'Envie a imagem no campo "imagem".');
    const mime = detectarMimeImagem(imagem);
    if (!mime) throw new ErroAplicacao('TIPO_NAO_SUPORTADO', 'Formato de imagem não suportado. Use JPEG, PNG ou WebP.');
    if (!this.extrator.disponivel()) throw new ErroAplicacao('INDISPONIVEL', MSG_IA_NAO_CONFIGURADA);

    const dia = hojeBrasil();
    const reservou = this.config.limiteDiario > 0 && (await this.limite.reservar(userId, dia, this.config.limiteDiario));
    if (!reservou) throw new ErroAplicacao('LIMITE_EXCEDIDO', MSG_LIMITE_ATINGIDO);

    let bruto: unknown;
    try {
      bruto = await this.extrator.extrair(imagem, mime);
    } catch (error) {
      await this.devolverReserva(userId, dia);
      // Sem mensagem do provedor: só o tipo do erro vai ao log.
      console.error('Falha na leitura de boleto por IA:', error instanceof ErroExtratorIndisponivel ? 'provedor' : 'inesperado');
      throw new ErroAplicacao('PROVEDOR_INDISPONIVEL', MSG_IA_FALHOU);
    }
    // O extrator devolve texto JSON; aceita também objeto já interpretado (extrator falso).
    const dados = typeof bruto === 'string' ? lerJsonDoModelo(bruto) : bruto;
    return sanearExtracao(dados);
  }

  private async devolverReserva(userId: number, dia: string): Promise<void> {
    try {
      await this.limite.devolver(userId, dia);
    } catch {
      console.error('Falha ao devolver a reserva do limite diário de leituras por IA');
    }
  }
}
