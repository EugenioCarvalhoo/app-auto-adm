import type { MimeImagem } from '../domain/extracao';

export const EXTRATOR_BOLETO = Symbol('ExtratorBoleto');
export const LIMITE_DIARIO = Symbol('LimiteDiario');
export const EXTRACAO_CONFIG = Symbol('ExtracaoConfig');

/** Falha do provedor de IA (rede, timeout, cota, resposta ilegível). Sem detalhes do provedor. */
export class ErroExtratorIndisponivel extends Error {
  constructor() {
    super('Extrator indisponível');
    this.name = 'ErroExtratorIndisponivel';
  }
}

/**
 * Lê a imagem de um boleto/nota e devolve a resposta BRUTA do modelo (não confiável, a sanear no domínio).
 * O adaptador isola o SDK; o resto do sistema não o conhece.
 */
export interface ExtratorBoleto {
  /** False quando não há credencial configurada (a rota responde 503). */
  disponivel(): boolean;
  /** Lança ErroExtratorIndisponivel em qualquer falha do provedor. */
  extrair(imagem: Buffer, mime: MimeImagem): Promise<unknown>;
}

/** Contador diário por usuário (atômico). */
export interface LimiteDiario {
  /** Reserva uma leitura do dia; false quando o limite já foi atingido. */
  reservar(usuarioId: number, dia: string, limite: number): Promise<boolean>;
  /** Devolve uma reserva (falha do provedor). Nunca fica abaixo de zero. */
  devolver(usuarioId: number, dia: string): Promise<void>;
}

export interface ExtracaoConfig {
  limiteDiario: number;
}
