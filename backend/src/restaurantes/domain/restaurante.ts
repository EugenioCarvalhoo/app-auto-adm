/** Restaurante como armazenado (SELECT *). */
export interface Restaurante {
  id: number;
  nome: string;
  endereco: string | null;
  telefone: string | null;
  email: string | null;
  cnpj: string | null;
  observacoes: string | null;
  ativo: boolean;
  created_at: Date;
  updated_at: Date;
}

/** Dados já normalizados para gravação (campos vazios viram null). */
export interface DadosRestaurante {
  nome: string;
  endereco: string | null;
  telefone: string | null;
  email: string | null;
  cnpj: string | null;
  observacoes: string | null;
}

/** Corpo cru recebido do cliente. */
export interface EntradaRestaurante {
  nome?: unknown;
  endereco?: unknown;
  telefone?: unknown;
  email?: unknown;
  cnpj?: unknown;
  observacoes?: unknown;
  ativo?: unknown;
}

/** Nome obrigatório; `.trim()` direto (valor não-string falha como antes e vira 500). Devolve null se inválido. */
export function normalizarRestaurante(entrada: EntradaRestaurante): DadosRestaurante | null {
  const { nome, endereco, telefone, email, cnpj, observacoes } = entrada;
  if (!nome || (nome as string).trim() === '') return null;
  return {
    nome: (nome as string).trim(),
    endereco: (endereco as string) || null,
    telefone: (telefone as string) || null,
    email: (email as string) || null,
    cnpj: (cnpj as string) || null,
    observacoes: (observacoes as string) || null
  };
}
