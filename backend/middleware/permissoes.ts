import type { NextFunction, Request, Response } from 'express';
import pool from '../db';

export interface UserFlags {
  id: number;
  is_admin: boolean;
  modulo_boletos: boolean;
}

/** Linha de usuarios usada para montar a resposta ao cliente. */
export interface UsuarioRow {
  id: number;
  username: string;
  nome: string;
}

export interface UserClient {
  id: number;
  username: string;
  nome: string;
  is_admin: boolean;
  modulo_boletos: boolean;
  restaurante_ids: number[];
}

export const requireModuloBoletos = async (req: Request, res: Response, next: NextFunction): Promise<void | Response> => {
  const flags = await loadUserFlags(req.user!.id);
  if (!flags) {
    return res.status(403).json({ error: 'Usuário inválido.' });
  }
  if (flags.is_admin || flags.modulo_boletos) {
    return next();
  }
  return res.status(403).json({ error: 'Sem permissão para o módulo de boletos e notas.' });
};

export const requireAdmin = (req: Request, res: Response, next: NextFunction): void | Response => {
  if (!req.user || !req.user.is_admin) {
    return res.status(403).json({ error: 'Apenas administradores podem realizar esta ação.' });
  }
  next();
};

/** Flags atuais do usuário (DB — não confiar só no JWT). Admin sempre tem boletos. */
export async function loadUserFlags(userId: number): Promise<UserFlags | null> {
  const r = await pool.query<{ id: number; is_admin: boolean | null; modulo_boletos: boolean | null }>(
    'SELECT id, is_admin, COALESCE(modulo_boletos, false) AS modulo_boletos FROM usuarios WHERE id = $1',
    [userId]
  );
  const row = r.rows[0];
  if (!row) return null;
  return { ...row, is_admin: !!row.is_admin, modulo_boletos: !!row.is_admin || !!row.modulo_boletos };
}

export async function shapeUserForClient(userRow: UsuarioRow): Promise<UserClient | null> {
  const flags = await loadUserFlags(userRow.id);
  if (!flags) return null;
  const restrito = usuarioRestaurantesRestritos(flags);
  return {
    id: userRow.id,
    username: userRow.username,
    nome: userRow.nome,
    is_admin: flags.is_admin,
    modulo_boletos: flags.modulo_boletos,
    restaurante_ids: restrito ? await restauranteIdsUsuario(userRow.id) : []
  };
}

/** Regra de negócio: só o admin enxerga todos os restaurantes; os demais, apenas os vinculados. */
export function usuarioRestaurantesRestritos(flags: UserFlags | null | undefined): boolean {
  return !!flags && !flags.is_admin;
}

export async function restauranteIdsUsuario(userId: number): Promise<number[]> {
  const r = await pool.query<{ restaurante_id: number }>(
    'SELECT restaurante_id FROM usuario_restaurantes WHERE usuario_id = $1 ORDER BY restaurante_id',
    [userId]
  );
  return r.rows.map((row) => row.restaurante_id);
}

export async function usuarioPodeRestaurante(userId: number, restauranteId: number): Promise<boolean> {
  const r = await pool.query(
    'SELECT 1 FROM usuario_restaurantes WHERE usuario_id = $1 AND restaurante_id = $2',
    [userId, restauranteId]
  );
  return r.rows.length > 0;
}

export async function assertBoletosAcessoRestaurante(
  req: Request,
  res: Response,
  restauranteId: unknown
): Promise<boolean> {
  const rid = parseInt(String(restauranteId), 10);
  if (Number.isNaN(rid)) {
    res.status(400).json({ error: 'restaurante_id inválido' });
    return false;
  }
  const flags = await loadUserFlags(req.user!.id);
  if (!flags) {
    res.status(403).json({ error: 'Usuário inválido.' });
    return false;
  }
  if (!(flags.is_admin || flags.modulo_boletos)) {
    res.status(403).json({ error: 'Sem permissão para o módulo de boletos e notas.' });
    return false;
  }
  if (flags.is_admin) return true;
  const ok = await usuarioPodeRestaurante(req.user!.id, rid);
  if (!ok) {
    res.status(403).json({ error: 'Sem permissão para os boletos deste restaurante.' });
    return false;
  }
  return true;
}
