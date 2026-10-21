const pool = require('../db');

const requireModuloBoletos = async (req, res, next) => {
  const flags = await loadUserFlags(req.user.id);
  if (!flags) {
    return res.status(403).json({ error: 'Usuário inválido.' });
  }
  if (flags.is_admin || flags.modulo_boletos) {
    return next();
  }
  return res.status(403).json({ error: 'Sem permissão para o módulo de boletos e notas.' });
};

const requireAdmin = (req, res, next) => {
  if (!req.user || !req.user.is_admin) {
    return res.status(403).json({ error: 'Apenas administradores podem realizar esta ação.' });
  }
  next();
};

/** Flags atuais do usuário (DB — não confiar só no JWT). */
function withAdminModules(row, extra = {}) {
  if (!row) return null;
  const base = {
    ...row,
    ...extra,
    modulo_boletos: extra.modulo_boletos !== undefined ? !!extra.modulo_boletos : !!row.modulo_boletos
  };
  if (row.is_admin) {
    return {
      ...base,
      modulo_financeiro: true,
      modulo_estoque: true,
      modulo_estoque_simplificado: true,
      modulo_boletos: true
    };
  }
  return base;
}

async function loadUserFlags(userId) {
  try {
    const r = await pool.query(
      `SELECT id, is_admin,
        COALESCE(somente_estoque, false) AS somente_estoque,
        COALESCE(modulo_financeiro, false) AS modulo_financeiro,
        COALESCE(modulo_estoque, false) AS modulo_estoque,
        COALESCE(modulo_estoque_simplificado, false) AS modulo_estoque_simplificado,
        COALESCE(modulo_boletos, false) AS modulo_boletos
       FROM usuarios WHERE id = $1`,
      [userId]
    );
    return withAdminModules(r.rows[0]);
  } catch (err) {
    if (err.code !== '42703') throw err;
  }
  try {
    const r = await pool.query(
      `SELECT id, is_admin,
        COALESCE(somente_estoque, false) AS somente_estoque,
        COALESCE(modulo_financeiro, false) AS modulo_financeiro,
        COALESCE(modulo_estoque, false) AS modulo_estoque,
        COALESCE(modulo_estoque_simplificado, false) AS modulo_estoque_simplificado
       FROM usuarios WHERE id = $1`,
      [userId]
    );
    const row = r.rows[0];
    if (!row) return null;
    return withAdminModules(row, {
      modulo_boletos: !!row.is_admin || !!row.modulo_financeiro
    });
  } catch (err) {
    if (err.code !== '42703') throw err;
    const r = await pool.query(
      'SELECT id, is_admin, COALESCE(somente_estoque, false) AS somente_estoque FROM usuarios WHERE id = $1',
      [userId]
    );
    const row = r.rows[0];
    if (!row) return null;
    const legadoEstoque = !!row.somente_estoque && !row.is_admin;
    return {
      ...row,
      modulo_financeiro: !!row.is_admin || !row.somente_estoque,
      modulo_estoque: !!row.is_admin || legadoEstoque,
      modulo_estoque_simplificado: !!row.is_admin,
      modulo_boletos: !!row.is_admin
    };
  }
}

async function shapeUserForClient(userRow) {
  const flags = await loadUserFlags(userRow.id);
  if (!flags) return null;
  let restauranteIds = [];
  const restrito = usuarioRestaurantesRestritos(flags);
  if (restrito) {
    restauranteIds = await restauranteIdsUsuarioEstoque(userRow.id);
  }
  return {
    id: userRow.id,
    username: userRow.username,
    nome: userRow.nome,
    is_admin: !!flags.is_admin,
    modulo_financeiro: !!flags.modulo_financeiro,
    modulo_estoque: !!flags.modulo_estoque,
    modulo_estoque_simplificado: !!flags.modulo_estoque_simplificado,
    modulo_boletos: !!flags.modulo_boletos,
    restaurante_ids: restauranteIds,
    somente_estoque: restrito
  };
}

/** Regra de negócio: só o admin enxerga todos os restaurantes; os demais, apenas os vinculados. */
function usuarioRestaurantesRestritos(flags) {
  return !!flags && !flags.is_admin;
}

async function restauranteIdsUsuarioEstoque(userId) {
  const r = await pool.query(
    'SELECT restaurante_id FROM usuario_restaurantes WHERE usuario_id = $1 ORDER BY restaurante_id',
    [userId]
  );
  return r.rows.map((row) => row.restaurante_id);
}

async function usuarioPodeRestaurante(userId, restauranteId) {
  const r = await pool.query(
    'SELECT 1 FROM usuario_restaurantes WHERE usuario_id = $1 AND restaurante_id = $2',
    [userId, restauranteId]
  );
  return r.rows.length > 0;
}

async function assertBoletosAcessoRestaurante(req, res, restauranteId) {
  const rid = parseInt(restauranteId, 10);
  if (Number.isNaN(rid)) {
    res.status(400).json({ error: 'restaurante_id inválido' });
    return false;
  }
  const flags = await loadUserFlags(req.user.id);
  if (!flags) {
    res.status(403).json({ error: 'Usuário inválido.' });
    return false;
  }
  if (!(flags.is_admin || flags.modulo_boletos)) {
    res.status(403).json({ error: 'Sem permissão para o módulo de boletos e notas.' });
    return false;
  }
  if (flags.is_admin) return true;
  const ok = await usuarioPodeRestaurante(req.user.id, rid);
  if (!ok) {
    res.status(403).json({ error: 'Sem permissão para os boletos deste restaurante.' });
    return false;
  }
  return true;
}

module.exports = {
  requireModuloBoletos,
  requireAdmin,
  loadUserFlags,
  shapeUserForClient,
  usuarioRestaurantesRestritos,
  restauranteIdsUsuarioEstoque,
  usuarioPodeRestaurante,
  assertBoletosAcessoRestaurante
};
