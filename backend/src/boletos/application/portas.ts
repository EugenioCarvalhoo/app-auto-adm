import type { BoletoRow, MetaRow } from '../domain/boleto';
import type { TipoBoleto } from '../domain/boletosSemana';

export const BOLETOS_REPOSITORY = Symbol('BoletosRepository');
export const METAS_REPOSITORY = Symbol('MetasRepository');

export interface NovoBoleto {
  restauranteId: number;
  usuarioId: number;
  dtRecebimento: string;
  dtVencimento: string | null;
  descricao: string;
  valor: number;
  tipo: TipoBoleto;
}

export interface AlteracaoBoleto {
  dtRecebimento: string;
  dtVencimento: string | null;
  descricao: string;
  valor: number;
  tipo: TipoBoleto;
}

export interface BoletosRepository {
  /** Mais antigos primeiro (usado no resumo semanal). */
  listarPorRecebimentoAsc(restauranteId: number): Promise<BoletoRow[]>;
  /** Mais recentes primeiro. */
  listarPorRestaurante(restauranteId: number): Promise<BoletoRow[]>;
  inserir(novo: NovoBoleto): Promise<BoletoRow>;
  buscarPorId(id: number): Promise<BoletoRow | null>;
  atualizar(id: number, alteracao: AlteracaoBoleto): Promise<BoletoRow>;
  buscarParaExclusao(id: number): Promise<{ restaurante_id: number; created_at: Date } | null>;
  excluir(id: number): Promise<void>;
}

export interface DadosMeta {
  dataReferencia: string;
  semanaChave: string;
  semanaInicio: string;
  semanaFim: string;
  maximoGasto: number;
}

export interface MetasRepository {
  listarPorSemanaAsc(restauranteId: number): Promise<MetaRow[]>;
  listarPorSemanaDesc(restauranteId: number): Promise<MetaRow[]>;
  /** Insere ou, se já existe meta da semana no restaurante, atualiza a data de referência e o máximo. */
  salvar(restauranteId: number, dados: DadosMeta): Promise<MetaRow>;
  buscarPorId(id: number): Promise<MetaRow | null>;
  atualizar(id: number, dados: DadosMeta): Promise<MetaRow>;
  buscarRestauranteId(id: number): Promise<number | null>;
  excluir(id: number): Promise<void>;
}
