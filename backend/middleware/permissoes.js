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

/** Flags atuais do usuário (DB — não confiar só no JWT). Admin sempre tem boletos. */
async function loadUserFlags(userId) {
  const r = await pool.query(
    'SELECT id, is_admin, COALESCE(modulo_boletos, false) AS modulo_boletos FROM usuarios WHERE id = $1',
    [userId]
  );
  const row = r.rows[0];
  if (!row) return null;
  return { ...row, is_admin: !!row.is_admin, modulo_boletos: !!row.is_admin || !!row.modulo_boletos };
}

async function shapeUserForClient(userRow) {
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
function usuarioRestaurantesRestritos(flags) {
  return !!flags && !flags.is_admin;
}

async function restauranteIdsUsuario(userId) {
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
  restauranteIdsUsuario,
  usuarioPodeRestaurante,
  assertBoletosAcessoRestaurante
};
