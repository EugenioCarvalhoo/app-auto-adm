/** Tipos compartilhados, alinhados aos contratos de backend/routes/*.ts. */

/** Usuário logado (resposta de /login e /verify; backend: shapeUserForClient). */
export interface Usuario {
  id: number;
  username: string;
  nome: string;
  is_admin: boolean;
  modulo_boletos: boolean;
  /** Vazio para admin (acesso a todos). */
  restaurante_ids: number[];
}

/** Subconjunto de Usuario usado para decidir permissões. */
export type UsuarioPermissao = Pick<Usuario, 'is_admin'> & Partial<Pick<Usuario, 'modulo_boletos'>>;

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

export type Tela = 'inicio' | 'boletos' | 'restaurantes' | 'permissoes';
