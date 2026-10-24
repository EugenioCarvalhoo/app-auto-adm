export const USUARIOS_PERMISSOES_REPOSITORY = Symbol('UsuariosPermissoesRepository');

export interface UsuarioPermissoesRow {
  id: number;
  username: string;
  nome: string;
  is_admin: boolean | null;
  modulo_boletos: boolean | null;
}

export interface UsuarioBasico {
  id: number;
  username: string;
  nome: string;
  is_admin: boolean;
}

export interface NovoUsuario {
  username: string;
  senhaHash: string;
  nome: string;
  moduloBoletos: boolean;
}

/**
 * Unidade de trabalho: uma conexão dedicada, usada do começo ao fim de uma operação
 * (consultas prévias, transação e gravação). Só vive dentro de `comSessao`.
 */
export interface SessaoPermissoes {
  existeUsername(username: string): Promise<boolean>;
  buscarUsuario(id: number): Promise<UsuarioBasico | null>;
  restauranteIdsDoUsuario(userId: number): Promise<number[]>;
  iniciarTransacao(): Promise<void>;
  confirmar(): Promise<void>;
  desfazer(): Promise<void>;
  inserirUsuario(novo: NovoUsuario): Promise<{ id: number; username: string; nome: string }>;
  atualizarModuloBoletos(userId: number, moduloBoletos: boolean): Promise<void>;
  /** Substitui os vínculos do usuário (só restaurantes ativos; ignora duplicados) e devolve os vínculos finais. */
  sincronizarRestaurantes(userId: number, restauranteIds: number[]): Promise<number[]>;
}

export interface UsuariosPermissoesRepository {
  /** Todos os usuários, admins primeiro e depois por nome. */
  listarTodos(): Promise<UsuarioPermissoesRow[]>;
  restauranteIdsDoUsuario(userId: number): Promise<number[]>;
  buscarPorId(id: number): Promise<UsuarioBasico | null>;
  remover(userId: number): Promise<void>;
  /** Abre uma sessão; ao terminar (ou falhar) faz rollback do que ficou pendente e libera a conexão. */
  comSessao<T>(operacao: (sessao: SessaoPermissoes) => Promise<T>): Promise<T>;
}
