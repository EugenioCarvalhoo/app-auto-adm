import express from 'express';
import bcrypt from 'bcryptjs';
import type { Queryable } from '../lib/tipos';
import pool from '../db';
import { authenticateToken } from '../middleware/auth';
import { requireAdmin } from '../middleware/permissoes';
import { codigoErro } from '../lib/erros';

interface UsuarioPermissoesRow {
  id: number;
  username: string;
  nome: string;
  is_admin: boolean | null;
  modulo_boletos: boolean | null;
}

const router = express.Router();

// ========== Admin: permissões por módulo ==========

async function listarRestauranteIdsUsuario(userId: number, db: Queryable = pool): Promise<number[]> {
  const assoc = await db.query<{ restaurante_id: number }>(
    'SELECT restaurante_id FROM usuario_restaurantes WHERE usuario_id = $1 ORDER BY restaurante_id',
    [userId]
  );
  return assoc.rows.map((row) => row.restaurante_id);
}

async function sincronizarRestaurantesUsuario(client: Queryable, userId: number, restauranteIds: unknown): Promise<number[]> {
  await client.query('DELETE FROM usuario_restaurantes WHERE usuario_id = $1', [userId]);
  const ids = Array.isArray(restauranteIds)
    ? [...new Set(restauranteIds.map((x) => parseInt(String(x), 10)).filter((x: number) => !Number.isNaN(x)))]
    : [];
  for (const rid of ids) {
    const ex = await client.query('SELECT id FROM restaurantes WHERE id = $1 AND ativo = true', [rid]);
    if (ex.rows.length === 0) continue;
    await client.query(
      `INSERT INTO usuario_restaurantes (usuario_id, restaurante_id) VALUES ($1, $2)
       ON CONFLICT (usuario_id, restaurante_id) DO NOTHING`,
      [userId, rid]
    );
  }
  return listarRestauranteIdsUsuario(userId, client);
}

router.get('/api/admin/usuarios-permissoes', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const result = await pool.query<UsuarioPermissoesRow>(
      `SELECT u.id, u.username, u.nome, u.is_admin,
        COALESCE(u.modulo_boletos, false) AS modulo_boletos
       FROM usuarios u
       ORDER BY u.is_admin DESC, u.nome ASC`
    );
    const rows = [];
    for (const row of result.rows) {
      const flags = row.is_admin
        ? { ...row, modulo_boletos: true }
        : row;
      const restaurante_ids = await listarRestauranteIdsUsuario(row.id);
      rows.push({
        id: flags.id,
        username: flags.username,
        nome: flags.nome,
        is_admin: !!flags.is_admin,
        modulo_boletos: !!flags.modulo_boletos,
        restaurante_ids
      });
    }
    res.json(rows);
  } catch (error) {
    if (codigoErro(error) === '42703') {
      return res.status(503).json({ error: 'Migração de permissões pendente (014).' });
    }
    console.error('Erro ao listar permissões:', error);
    res.status(500).json({ error: 'Erro ao listar permissões de usuários' });
  }
});

router.post('/api/admin/usuarios-permissoes', authenticateToken, requireAdmin, async (req, res) => {
  const client = await pool.connect();
  try {
    const body = req.body || {};
    const username = String(body.username || '').trim();
    const password = String(body.password || '');
    const nome = String(body.nome || '').trim();
    if (!username) {
      return res.status(400).json({ error: 'Login é obrigatório' });
    }
    if (password.length < 4) {
      return res.status(400).json({ error: 'Senha é obrigatória (mín. 4 caracteres).' });
    }
    if (!nome) {
      return res.status(400).json({ error: 'Nome é obrigatório' });
    }

    const moduloBoletos = body.modulo_boletos === true;
    if (!moduloBoletos) {
      return res.status(400).json({ error: 'Marque ao menos um módulo para o usuário.' });
    }

    const restrito = true; // todo usuário não-admin precisa de restaurantes liberados
    const restauranteIds = Array.isArray(body.restaurante_ids)
      ? body.restaurante_ids.map((x: unknown) => parseInt(String(x), 10)).filter((x: number) => !Number.isNaN(x))
      : [];
    if (restrito && restauranteIds.length === 0) {
      return res.status(400).json({
        error: 'Usuário não-admin precisa de ao menos um restaurante liberado.'
      });
    }

    const dup = await client.query('SELECT id FROM usuarios WHERE username = $1', [username]);
    if (dup.rows.length > 0) {
      return res.status(409).json({ error: 'Já existe usuário com este login.' });
    }

    const hash = await bcrypt.hash(password, 10);
    await client.query('BEGIN');
    const ins = await client.query<{ id: number; username: string; nome: string }>(
      `INSERT INTO usuarios (username, password, nome, is_admin, modulo_boletos)
       VALUES ($1, $2, $3, false, $4)
       RETURNING id, username, nome`,
      [username, hash, nome, moduloBoletos]
    );
    const newUser = ins.rows[0];
    let ids: number[] = [];
    if (restrito) {
      ids = await sincronizarRestaurantesUsuario(client, newUser.id, restauranteIds);
      if (ids.length === 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Nenhum dos restaurantes informados é válido ou está ativo.' });
      }
    }
    await client.query('COMMIT');
    res.status(201).json({
      id: newUser.id,
      username: newUser.username,
      nome: newUser.nome,
      is_admin: false,
      modulo_boletos: moduloBoletos,
      restaurante_ids: ids
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (codigoErro(error) === '42703') {
      return res.status(503).json({ error: 'Migração de permissões pendente (014).' });
    }
    if (codigoErro(error) === '23505') {
      return res.status(409).json({ error: 'Já existe usuário com este login.' });
    }
    console.error('Erro ao criar usuário:', error);
    res.status(500).json({ error: 'Erro ao criar usuário' });
  } finally {
    client.release();
  }
});

router.put('/api/admin/usuarios-permissoes/:id', authenticateToken, requireAdmin, async (req, res) => {
  const client = await pool.connect();
  try {
    const userId = parseInt(req.params.id, 10);
    if (Number.isNaN(userId)) {
      return res.status(400).json({ error: 'id inválido' });
    }
    const cur = await client.query<{ id: number; username: string; nome: string; is_admin: boolean }>('SELECT * FROM usuarios WHERE id = $1', [userId]);
    if (cur.rows.length === 0) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }
    const usuario = cur.rows[0];
    if (usuario.is_admin) {
      return res.status(400).json({ error: 'Permissões de administrador não podem ser alteradas.' });
    }

    const body = req.body || {};
    // Revogar o módulo é válido (false), mas omitir o campo não pode revogar sem querer.
    if (typeof body.modulo_boletos !== 'boolean') {
      return res.status(400).json({ error: 'Informe modulo_boletos (true ou false).' });
    }
    const moduloBoletos = body.modulo_boletos;

    const restrito = true; // todo usuário não-admin precisa de restaurantes liberados
    let restauranteIds: number[] = [];
    if (restrito) {
      restauranteIds = Array.isArray(body.restaurante_ids)
        ? body.restaurante_ids.map((x: unknown) => parseInt(String(x), 10)).filter((x: number) => !Number.isNaN(x))
        : await listarRestauranteIdsUsuario(userId);
      if (restauranteIds.length === 0) {
        return res.status(400).json({
          error: 'Usuário não-admin precisa de ao menos um restaurante liberado.'
        });
      }
    }

    await client.query('BEGIN');
    await client.query(
      `UPDATE usuarios
       SET modulo_boletos = $1,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $2`,
      [moduloBoletos, userId]
    );

    if (restrito) {
      restauranteIds = await sincronizarRestaurantesUsuario(client, userId, restauranteIds);
    } else {
      await client.query('DELETE FROM usuario_restaurantes WHERE usuario_id = $1', [userId]);
      restauranteIds = [];
    }

    await client.query('COMMIT');

    res.json({
      id: userId,
      username: usuario.username,
      nome: usuario.nome,
      is_admin: false,
      modulo_boletos: moduloBoletos,
      restaurante_ids: restauranteIds
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (codigoErro(error) === '42703') {
      return res.status(503).json({ error: 'Migração de permissões pendente (014).' });
    }
    console.error('Erro ao atualizar permissões:', error);
    res.status(500).json({ error: 'Erro ao atualizar permissões' });
  } finally {
    client.release();
  }
});

router.delete('/api/admin/usuarios-permissoes/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const userId = parseInt(req.params.id, 10);
    if (Number.isNaN(userId)) {
      return res.status(400).json({ error: 'id inválido' });
    }
    if (userId === req.user!.id) {
      return res.status(400).json({ error: 'Não é possível remover o próprio usuário.' });
    }
    const cur = await pool.query<{ id: number; is_admin: boolean }>('SELECT id, is_admin FROM usuarios WHERE id = $1', [userId]);
    if (cur.rows.length === 0) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }
    if (cur.rows[0].is_admin) {
      return res.status(400).json({ error: 'Não é possível remover um administrador.' });
    }
    await pool.query('DELETE FROM usuarios WHERE id = $1', [userId]);
    res.json({ message: 'Usuário removido', id: userId });
  } catch (error) {
    if (codigoErro(error) === '23503') {
      return res.status(409).json({
        error: 'Este usuário ainda está ligado a outros registros e não pode ser removido.'
      });
    }
    console.error('Erro ao remover usuário:', error);
    res.status(500).json({ error: 'Erro ao remover usuário' });
  }
});

export = router;
