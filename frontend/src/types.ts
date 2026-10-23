/** Tipos compartilhados, alinhados aos contratos de backend/routes/*.ts. */

/** Usuário logado (resposta de /login e /verify; backend: shapeUserForClient). */
export interface Usuario {
  id: number;
  username: string;
  nome: string;
  is_admin: boolean;
  modulo_boletos: boolean;
  /** Pode marcar boletos como pagos (admin sempre pode). */
  pode_marcar_pago?: boolean;
  /** Vazio para admin (acesso a todos). */
  restaurante_ids: number[];
}

/** Subconjunto de Usuario usado para decidir permissões. */
export type UsuarioPermissao = Pick<Usuario, 'is_admin'> & Partial<Pick<Usuario, 'modulo_boletos' | 'pode_marcar_pago'>>;

export interface LoginResposta {
  token: string;
  user: Usuario;
}

export interface VerifyResposta {
  user: Usuario;
}

/** Linha de restaurantes devolvida pela API (SELECT *). */
export interface Restaurante {
  id: number;
  nome: string;
  endereco: string | null;
  telefone: string | null;
  email: string | null;
  cnpj: string | null;
  observacoes: string | null;
  ativo: boolean;
  created_at: string;
  updated_at: string;
}

/** Corpo enviado em POST/PUT /restaurantes. */
export interface RestauranteForm {
  nome: string;
  endereco: string;
  telefone: string;
  email: string;
  cnpj: string;
  observacoes: string;
}

export type TipoDado = 'Boleto' | 'Sem Boleto';

export interface Boleto {
  id: number;
  restaurante_id: number;
  dt_recebimento: string | null;
  dt_vencimento: string | null;
  descricao: string;
  valor: number;
  tipo: TipoDado;
  dt_vencimento_efetivo: string | null;
  semana_inicio: string | null;
  semana_fim: string | null;
  semana_chave: string | null;
  created_at?: string | null;
  fornecedor: string | null;
  /** Só dígitos (47 ou 48). */
  linha_digitavel: string | null;
  pago: boolean;
  pago_em: string | null;
  pago_por_usuario_id: number | null;
  anexo_id: number | null;
  tem_anexo: boolean;
}

export type CampoLido = 'fornecedor' | 'valor' | 'dt_vencimento' | 'dt_recebimento' | 'linha_digitavel';

/** Resposta de POST /boletos/extrair. */
export interface ExtracaoResposta {
  /** SHA-256 da imagem lida; vai de volta em POST /boletos/:id/anexo após o cadastro. */
  hash_sha256: string;
  tipo_documento: string | null;
  tipo_sugerido: TipoDado | null;
  fornecedor: string | null;
  valor: number | null;
  dt_vencimento: string | null;
  dt_recebimento: string | null;
  linha_digitavel: string | null;
  campos_nao_lidos: CampoLido[];
  avisos: string[];
  /** Imagem já cadastrada: boleto existente (enriquecido) ou true. */
  aviso_imagem_repetida?: Boleto | true;
}

/** Corpo do 409 de POST /boletos. */
export interface ConflitoBoleto {
  error?: string;
  codigo?: 'LINHA_DUPLICADA' | 'BOLETO_SIMILAR';
  boletos?: Boleto[];
}

/** Corpo do 429 de POST /boletos/extrair no teto diário (o por minuto não traz `codigo`). */
export interface ErroLimiteLeitura {
  error?: string;
  codigo?: 'LIMITE_DIARIO';
}

/** Item de GET /admin/boletos-ocorrencias. */
export interface OcorrenciaBoleto {
  id: number;
  tipo: string;
  usuario_id: number | null;
  usuario_nome: string | null;
  usuario_username: string | null;
  restaurante_id: number | null;
  restaurante_nome: string | null;
  boleto_existente_id: number | null;
  boleto_existente_restaurante_nome: string | null;
  boleto_existente_fornecedor: string | null;
  linha_digitavel: string | null;
  visto_em: string | null;
  created_at: string;
}

export interface SemanaResumo {
  chave: string;
  inicio: string;
  fim: string;
  total: number;
  quantidade: number;
  maximo: number | null;
  saldo: number | null;
}

export interface Meta {
  id: number;
  data_referencia: string;
  semana_inicio: string;
  semana_fim: string;
  maximo_gasto: number;
}

export type Tela = 'inicio' | 'boletos' | 'restaurantes' | 'permissoes' | 'ocorrencias';
