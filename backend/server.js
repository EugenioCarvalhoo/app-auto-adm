const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');

// Carregar .env do diretório backend ANTES de importar outros módulos
dotenv.config({ path: path.join(__dirname, '.env') });

const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { authenticateToken, JWT_SECRET } = require('./middleware/auth');
const {
  intervaloSemana,
  normalizarTipo,
  vencimentoEfetivo,
  grupoSemana
} = require('./lib/boletosSemana');

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
    'SELECT restaurante_id FROM usuario_restaurante_estoque WHERE usuario_id = $1 ORDER BY restaurante_id',
    [userId]
  );
  return r.rows.map((row) => row.restaurante_id);
}

async function usuarioPodeRestaurante(userId, restauranteId) {
  const r = await pool.query(
    'SELECT 1 FROM usuario_restaurante_estoque WHERE usuario_id = $1 AND restaurante_id = $2',
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

function hojeBrasil() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
}

function dateToIso(value) {
  if (!value) return null;
  if (typeof value === 'string') {
    const text = value.slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  return null;
}

// Limite de NUMERIC(14,2): 12 dígitos inteiros. Acima disso o Postgres devolve erro (500).
const VALOR_BOLETO_MAX = 999999999999.99;

function parseValorBoleto(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  let value;
  if (typeof raw === 'number') {
    value = raw;
  } else {
    const text = String(raw).trim().replace(/\s/g, '').replace(/^R\$/i, '');
    if (!text) return null;
    const normalized = text.includes(',') ? text.replace(/\./g, '').replace(',', '.') : text;
    value = Number(normalized);
  }
  if (!Number.isFinite(value) || value < 0 || value > VALOR_BOLETO_MAX) return null;
  return Math.round(value * 100) / 100;
}

function erroTabelaBoletos(error, res) {
  if (error.code === '42P01' || error.code === '42703') {
    res.status(503).json({ error: 'Módulo de boletos não instalado. Rode a migração 014.' });
    return true;
  }
  return false;
}

function enriquecerBoleto(row) {
  const dtRecebimento = dateToIso(row.dt_recebimento);
  const dtVencimento = dateToIso(row.dt_vencimento);
  const tipo = normalizarTipo(row.tipo);
  const efetivo = vencimentoEfetivo(dtRecebimento, dtVencimento, tipo);
  const semana = grupoSemana(dtRecebimento, dtVencimento, tipo);
  return {
    id: row.id,
    restaurante_id: row.restaurante_id,
    usuario_id: row.usuario_id,
    dt_recebimento: dtRecebimento,
    dt_vencimento: dtVencimento,
    descricao: row.descricao || '',
    valor: Number(row.valor),
    tipo,
    dt_vencimento_efetivo: efetivo,
    semana_chave: semana ? semana.chave : null,
    semana_inicio: semana ? semana.inicio : null,
    semana_fim: semana ? semana.fim : null,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function enriquecerMeta(row) {
  return {
    id: row.id,
    restaurante_id: row.restaurante_id,
    data_referencia: dateToIso(row.data_referencia),
    semana_chave: row.semana_chave,
    semana_inicio: dateToIso(row.semana_inicio),
    semana_fim: dateToIso(row.semana_fim),
    maximo_gasto: Number(row.maximo_gasto),
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

const BOLETO_SELECT = `id, restaurante_id, usuario_id, dt_recebimento, dt_vencimento, descricao, valor, tipo, created_at, updated_at`;
const META_SELECT = `id, restaurante_id, data_referencia, semana_chave, semana_inicio, semana_fim, maximo_gasto, created_at, updated_at`;

function parseDateOnly(s) {
  if (!s || typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T12:00:00Z`);
  // Rejeita datas impossíveis (ex.: 2026-02-31), que o JS "rola" para o mês seguinte.
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s ? null : s;
}

const app = express();
const PORT = process.env.PORT || 5000;

// Aumentar limite de headers para evitar erro 431
app.use((req, res, next) => {
  req.headers['content-length'] = req.headers['content-length'] || '0';
  next();
});

// Middleware
app.use(cors({
  credentials: true,
  maxAge: 86400
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Uma linha por requisição ao fim da resposta — confirma se o proxy chega no Node (LOG_HTTP=0 desliga)
if (
  process.env.NODE_ENV !== 'test' &&
  process.env.LOG_HTTP !== '0' &&
  process.env.LOG_HTTP !== 'false'
) {
  app.use((req, res, next) => {
    const t0 = Date.now();
    res.on('finish', () => {
      const ms = Date.now() - t0;
      console.log(`[http] ${req.method} ${req.originalUrl || req.url} -> ${res.statusCode} (${ms}ms)`);
    });
    next();
  });
}

// Database connection
const pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'controle_financeiro',
  password: process.env.DB_PASSWORD || 'postgres',
  port: parseInt(process.env.DB_PORT, 10) || 5432,
});

// Log de debug e ping inicial (evita ruído e conexão real em testes automatizados)
if (process.env.NODE_ENV !== 'test') {
  console.log('🔍 Configuração do Banco:');
  console.log('  DB_HOST:', process.env.DB_HOST || '(não definido)');
  console.log('  DB_PORT:', process.env.DB_PORT || '(não definido)');
  console.log('  DB_NAME:', process.env.DB_NAME || '(não definido)');
  console.log('  DB_USER:', process.env.DB_USER || '(não definido)');

  pool.query('SELECT NOW()', (err, res) => {
    if (err) {
      console.error('Erro ao conectar ao banco de dados:', err);
    } else {
      console.log('Conectado ao PostgreSQL:', res.rows[0].now);
    }
  });
}

// Auth Routes — login em /api/login e /login (proxy que remove o prefixo /api)
async function loginHandler(req, res) {
  try {
    console.log('Tentativa de login recebida');
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username e senha são obrigatórios' });
    }

    console.log('Buscando usuário:', username);
    const result = await pool.query(
      'SELECT * FROM usuarios WHERE username = $1',
      [username]
    );

    if (result.rows.length === 0) {
      console.log('Usuário não encontrado');
      return res.status(401).json({ error: 'Credenciais inválidas' });
    }

    const user = result.rows[0];
    console.log('Usuário encontrado, verificando senha...');

    const validPassword = await bcrypt.compare(password, user.password);

    if (!validPassword) {
      console.log('Senha inválida');
      return res.status(401).json({ error: 'Credenciais inválidas' });
    }

    console.log('Senha válida, gerando token...');
    const shaped = await shapeUserForClient(user);
    if (!shaped) {
      return res.status(500).json({ error: 'Erro ao carregar perfil do usuário.' });
    }
    const token = jwt.sign(
      {
        id: user.id,
        username: user.username,
        is_admin: shaped.is_admin,
        modulo_financeiro: shaped.modulo_financeiro,
        modulo_estoque: shaped.modulo_estoque,
        modulo_estoque_simplificado: shaped.modulo_estoque_simplificado,
        modulo_boletos: shaped.modulo_boletos,
        somente_estoque: shaped.somente_estoque
      },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    console.log('Login bem-sucedido para:', username);
    res.json({
      token,
      user: shaped
    });
  } catch (error) {
    console.error('Erro no login:', error);
    console.error('Stack trace:', error.stack);
    res.status(500).json({
      error: 'Erro ao fazer login',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
}

app.post('/api/login', loginHandler);
app.post('/login', loginHandler);

// Verify token
app.get('/api/verify', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM usuarios WHERE id = $1', [req.user.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }
    const shaped = await shapeUserForClient(result.rows[0]);
    if (!shaped) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }
    res.json({ user: shaped });
  } catch (error) {
    console.error('Erro ao verificar token:', error);
    res.status(500).json({ error: 'Erro ao verificar token' });
  }
});

// Protected Routes
// Restaurantes Routes
// Get all restaurants
app.get('/api/restaurantes', authenticateToken, async (req, res) => {
  try {
    const flags = await loadUserFlags(req.user.id);
    if (!flags) {
      return res.status(403).json({ error: 'Usuário inválido.' });
    }
    if (usuarioRestaurantesRestritos(flags)) {
      const result = await pool.query(
        `SELECT r.*
         FROM restaurantes r
         INNER JOIN usuario_restaurante_estoque ur ON ur.restaurante_id = r.id AND ur.usuario_id = $1
         WHERE r.ativo = true
         ORDER BY r.nome ASC`,
        [req.user.id]
      );
      return res.json(result.rows);
    }
    const result = await pool.query(
      'SELECT * FROM restaurantes WHERE ativo = true ORDER BY nome ASC'
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Erro ao buscar restaurantes:', error);
    res.status(500).json({ error: 'Erro ao buscar restaurantes' });
  }
});

// Get single restaurant
app.get('/api/restaurantes/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const rid = parseInt(id, 10);
    const flags = await loadUserFlags(req.user.id);
    if (flags && usuarioRestaurantesRestritos(flags)) {
      const ok = await usuarioPodeRestaurante(req.user.id, rid);
      if (!ok) {
        return res.status(403).json({ error: 'Sem acesso a este restaurante.' });
      }
    }
    const result = await pool.query('SELECT * FROM restaurantes WHERE id = $1', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Restaurante não encontrado' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Erro ao buscar restaurante:', error);
    res.status(500).json({ error: 'Erro ao buscar restaurante' });
  }
});

// Create restaurant
app.post('/api/restaurantes', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { nome, endereco, telefone, email, cnpj, observacoes } = req.body;
    
    if (!nome || nome.trim() === '') {
      return res.status(400).json({ error: 'Nome é obrigatório' });
    }
    
    const result = await pool.query(
      'INSERT INTO restaurantes (nome, endereco, telefone, email, cnpj, observacoes) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
      [nome.trim(), endereco || null, telefone || null, email || null, cnpj || null, observacoes || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Erro ao criar restaurante:', error);
    res.status(500).json({ error: 'Erro ao criar restaurante' });
  }
});

// Update restaurant
app.put('/api/restaurantes/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { nome, endereco, telefone, email, cnpj, observacoes, ativo } = req.body;
    
    if (!nome || nome.trim() === '') {
      return res.status(400).json({ error: 'Nome é obrigatório' });
    }
    
    const result = await pool.query(
      'UPDATE restaurantes SET nome = $1, endereco = $2, telefone = $3, email = $4, cnpj = $5, observacoes = $6, ativo = $7, updated_at = CURRENT_TIMESTAMP WHERE id = $8 RETURNING *',
      [nome.trim(), endereco || null, telefone || null, email || null, cnpj || null, observacoes || null, ativo !== undefined ? ativo : true, id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Restaurante não encontrado' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Erro ao atualizar restaurante:', error);
    res.status(500).json({ error: 'Erro ao atualizar restaurante' });
  }
});

// Delete restaurant (soft delete - marca como inativo)
app.delete('/api/restaurantes/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      'UPDATE restaurantes SET ativo = false, updated_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING *',
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Restaurante não encontrado' });
    }
    res.json({ message: 'Restaurante desativado com sucesso' });
  } catch (error) {
    console.error('Erro ao deletar restaurante:', error);
    res.status(500).json({ error: 'Erro ao deletar restaurante' });
  }
});

// ========== Boletos e notas ==========

app.get('/api/boletos/resumo', authenticateToken, requireModuloBoletos, async (req, res) => {
  try {
    const rid = parseInt(req.query.restaurante_id, 10);
    if (Number.isNaN(rid)) {
      return res.status(400).json({ error: 'restaurante_id é obrigatório' });
    }
    const pode = await assertBoletosAcessoRestaurante(req, res, rid);
    if (!pode) return;

    const [boletos, metas] = await Promise.all([
      pool.query(
        `SELECT ${BOLETO_SELECT} FROM boletos_notas WHERE restaurante_id = $1 ORDER BY dt_recebimento ASC, id ASC`,
        [rid]
      ),
      pool.query(
        `SELECT ${META_SELECT} FROM boletos_metas_gasto WHERE restaurante_id = $1 ORDER BY semana_inicio ASC`,
        [rid]
      )
    ]);

    const porSemana = new Map();
    boletos.rows.forEach((row) => {
      const item = enriquecerBoleto(row);
      if (!item.semana_chave) return;
      const atual = porSemana.get(item.semana_chave) || {
        chave: item.semana_chave,
        inicio: item.semana_inicio,
        fim: item.semana_fim,
        total: 0,
        quantidade: 0,
        maximo: null
      };
      atual.total = Math.round((atual.total + item.valor) * 100) / 100;
      atual.quantidade += 1;
      porSemana.set(item.semana_chave, atual);
    });

    metas.rows.forEach((row) => {
      const meta = enriquecerMeta(row);
      const atual = porSemana.get(meta.semana_chave) || {
        chave: meta.semana_chave,
        inicio: meta.semana_inicio,
        fim: meta.semana_fim,
        total: 0,
        quantidade: 0,
        maximo: null
      };
      atual.maximo = meta.maximo_gasto;
      porSemana.set(meta.semana_chave, atual);
    });

    const semanas = [...porSemana.values()]
      .sort((a, b) => a.chave.localeCompare(b.chave))
      .map((semana) => ({
        ...semana,
        saldo: semana.maximo == null ? null : Math.round((semana.maximo - semana.total) * 100) / 100
      }));
    const totalGeral = Math.round(semanas.reduce((acc, semana) => acc + semana.total, 0) * 100) / 100;

    res.json({ semanas, total_geral: totalGeral });
  } catch (error) {
    if (erroTabelaBoletos(error, res)) return;
    console.error('Erro ao resumir boletos:', error);
    res.status(500).json({ error: 'Erro ao calcular o total da semana' });
  }
});

app.get('/api/boletos', authenticateToken, requireModuloBoletos, async (req, res) => {
  try {
    const rid = parseInt(req.query.restaurante_id, 10);
    if (Number.isNaN(rid)) {
      return res.status(400).json({ error: 'restaurante_id é obrigatório' });
    }
    const pode = await assertBoletosAcessoRestaurante(req, res, rid);
    if (!pode) return;
    const result = await pool.query(
      `SELECT ${BOLETO_SELECT} FROM boletos_notas WHERE restaurante_id = $1 ORDER BY dt_recebimento DESC NULLS LAST, id DESC`,
      [rid]
    );
    res.json(result.rows.map(enriquecerBoleto));
  } catch (error) {
    if (erroTabelaBoletos(error, res)) return;
    console.error('Erro ao listar boletos:', error);
    res.status(500).json({ error: 'Erro ao listar boletos e notas' });
  }
});

app.post('/api/boletos', authenticateToken, requireModuloBoletos, async (req, res) => {
  try {
    const body = req.body || {};
    const rid = parseInt(body.restaurante_id, 10);
    if (Number.isNaN(rid)) {
      return res.status(400).json({ error: 'restaurante_id é obrigatório' });
    }
    const pode = await assertBoletosAcessoRestaurante(req, res, rid);
    if (!pode) return;

    const descricao = body.descricao != null ? String(body.descricao).trim() : '';
    if (!descricao) {
      return res.status(400).json({ error: 'Descrição é obrigatória' });
    }
    const valor = parseValorBoleto(body.valor);
    if (valor == null) {
      return res.status(400).json({ error: 'Valor inválido' });
    }
    const tipo = normalizarTipo(body.tipo);
    let dtRecebimento = body.dt_recebimento ? parseDateOnly(String(body.dt_recebimento).slice(0, 10)) : null;
    if (tipo === 'Sem Boleto' && !dtRecebimento) {
      dtRecebimento = hojeBrasil();
    }
    if (!dtRecebimento) {
      return res.status(400).json({ error: 'Data de recebimento é obrigatória' });
    }
    let dtVencimento = null;
    if (tipo === 'Boleto') {
      dtVencimento = body.dt_vencimento ? parseDateOnly(String(body.dt_vencimento).slice(0, 10)) : null;
      if (!dtVencimento) {
        return res.status(400).json({ error: 'Data de vencimento é obrigatória para boleto' });
      }
    }

    const result = await pool.query(
      `INSERT INTO boletos_notas (restaurante_id, usuario_id, dt_recebimento, dt_vencimento, descricao, valor, tipo)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING ${BOLETO_SELECT}`,
      [rid, req.user.id, dtRecebimento, dtVencimento, descricao, valor, tipo]
    );
    res.status(201).json(enriquecerBoleto(result.rows[0]));
  } catch (error) {
    if (erroTabelaBoletos(error, res)) return;
    console.error('Erro ao criar boleto:', error);
    res.status(500).json({ error: 'Erro ao cadastrar boleto ou nota' });
  }
});

app.put('/api/boletos/:id', authenticateToken, requireModuloBoletos, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      return res.status(400).json({ error: 'id inválido' });
    }
    const existing = await pool.query(`SELECT ${BOLETO_SELECT} FROM boletos_notas WHERE id = $1`, [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Lançamento não encontrado' });
    }
    const atual = existing.rows[0];
    const pode = await assertBoletosAcessoRestaurante(req, res, atual.restaurante_id);
    if (!pode) return;

    const body = req.body || {};
    const descricao = body.descricao !== undefined ? String(body.descricao).trim() : atual.descricao;
    if (!descricao) {
      return res.status(400).json({ error: 'Descrição é obrigatória' });
    }
    const valor = body.valor !== undefined ? parseValorBoleto(body.valor) : Number(atual.valor);
    if (valor == null) {
      return res.status(400).json({ error: 'Valor inválido' });
    }
    const tipo = body.tipo !== undefined ? normalizarTipo(body.tipo) : normalizarTipo(atual.tipo);
    let dtRecebimento = body.dt_recebimento !== undefined
      ? parseDateOnly(String(body.dt_recebimento || '').slice(0, 10))
      : dateToIso(atual.dt_recebimento);
    if (tipo === 'Sem Boleto' && !dtRecebimento) {
      dtRecebimento = hojeBrasil();
    }
    if (!dtRecebimento) {
      return res.status(400).json({ error: 'Data de recebimento é obrigatória' });
    }
    let dtVencimento = dateToIso(atual.dt_vencimento);
    if (tipo === 'Sem Boleto') {
      dtVencimento = null;
    } else if (body.dt_vencimento !== undefined) {
      dtVencimento = body.dt_vencimento
        ? parseDateOnly(String(body.dt_vencimento).slice(0, 10))
        : null;
    }
    if (tipo === 'Boleto' && !dtVencimento) {
      return res.status(400).json({ error: 'Data de vencimento é obrigatória para boleto' });
    }

    const result = await pool.query(
      `UPDATE boletos_notas
       SET dt_recebimento = $1, dt_vencimento = $2, descricao = $3, valor = $4, tipo = $5, updated_at = CURRENT_TIMESTAMP
       WHERE id = $6
       RETURNING ${BOLETO_SELECT}`,
      [dtRecebimento, dtVencimento, descricao, valor, tipo, id]
    );
    res.json(enriquecerBoleto(result.rows[0]));
  } catch (error) {
    if (erroTabelaBoletos(error, res)) return;
    console.error('Erro ao atualizar boleto:', error);
    res.status(500).json({ error: 'Erro ao atualizar boleto ou nota' });
  }
});

app.delete('/api/boletos/:id', authenticateToken, requireModuloBoletos, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      return res.status(400).json({ error: 'id inválido' });
    }
    const existing = await pool.query(
      'SELECT restaurante_id, created_at FROM boletos_notas WHERE id = $1',
      [id]
    );
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Lançamento não encontrado' });
    }
    const pode = await assertBoletosAcessoRestaurante(req, res, existing.rows[0].restaurante_id);
    if (!pode) return;
    const flags = await loadUserFlags(req.user.id);
    if (!flags || !flags.is_admin) {
      const criado = new Date(existing.rows[0].created_at).getTime();
      const passouUmDia = !Number.isFinite(criado) || Date.now() - criado > 24 * 60 * 60 * 1000;
      if (passouUmDia) {
        return res.status(403).json({
          error: 'Só o administrador pode excluir um lançamento com mais de 1 dia.'
        });
      }
    }
    await pool.query('DELETE FROM boletos_notas WHERE id = $1', [id]);
    res.json({ message: 'Lançamento removido', id });
  } catch (error) {
    if (erroTabelaBoletos(error, res)) return;
    console.error('Erro ao remover boleto:', error);
    res.status(500).json({ error: 'Erro ao remover boleto ou nota' });
  }
});

app.get('/api/boletos/metas', authenticateToken, requireModuloBoletos, async (req, res) => {
  try {
    const rid = parseInt(req.query.restaurante_id, 10);
    if (Number.isNaN(rid)) {
      return res.status(400).json({ error: 'restaurante_id é obrigatório' });
    }
    const pode = await assertBoletosAcessoRestaurante(req, res, rid);
    if (!pode) return;
    const result = await pool.query(
      `SELECT ${META_SELECT} FROM boletos_metas_gasto WHERE restaurante_id = $1 ORDER BY semana_inicio DESC`,
      [rid]
    );
    res.json(result.rows.map(enriquecerMeta));
  } catch (error) {
    if (erroTabelaBoletos(error, res)) return;
    console.error('Erro ao listar metas:', error);
    res.status(500).json({ error: 'Erro ao listar metas de gasto' });
  }
});

app.post('/api/boletos/metas', authenticateToken, requireModuloBoletos, async (req, res) => {
  try {
    const body = req.body || {};
    const rid = parseInt(body.restaurante_id, 10);
    if (Number.isNaN(rid)) {
      return res.status(400).json({ error: 'restaurante_id é obrigatório' });
    }
    const pode = await assertBoletosAcessoRestaurante(req, res, rid);
    if (!pode) return;
    const dataReferencia = parseDateOnly(String(body.data_referencia || '').slice(0, 10));
    if (!dataReferencia) {
      return res.status(400).json({ error: 'Informe uma data dentro da semana da meta' });
    }
    const maximo = parseValorBoleto(body.maximo_gasto);
    if (maximo == null) {
      return res.status(400).json({ error: 'Máximo de gasto inválido' });
    }
    const semana = intervaloSemana(dataReferencia);
    const result = await pool.query(
      `INSERT INTO boletos_metas_gasto (restaurante_id, data_referencia, semana_chave, semana_inicio, semana_fim, maximo_gasto)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (restaurante_id, semana_chave)
       DO UPDATE SET data_referencia = EXCLUDED.data_referencia,
                     maximo_gasto = EXCLUDED.maximo_gasto,
                     updated_at = CURRENT_TIMESTAMP
       RETURNING ${META_SELECT}`,
      [rid, dataReferencia, semana.chave, semana.inicio, semana.fim, maximo]
    );
    res.status(201).json(enriquecerMeta(result.rows[0]));
  } catch (error) {
    if (erroTabelaBoletos(error, res)) return;
    console.error('Erro ao salvar meta:', error);
    res.status(500).json({ error: 'Erro ao salvar meta de gasto' });
  }
});

app.put('/api/boletos/metas/:id', authenticateToken, requireModuloBoletos, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      return res.status(400).json({ error: 'id inválido' });
    }
    const existing = await pool.query(`SELECT ${META_SELECT} FROM boletos_metas_gasto WHERE id = $1`, [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Meta não encontrada' });
    }
    const atual = existing.rows[0];
    const pode = await assertBoletosAcessoRestaurante(req, res, atual.restaurante_id);
    if (!pode) return;
    const body = req.body || {};
    const dataReferencia = body.data_referencia !== undefined
      ? parseDateOnly(String(body.data_referencia || '').slice(0, 10))
      : dateToIso(atual.data_referencia);
    if (!dataReferencia) {
      return res.status(400).json({ error: 'Informe uma data dentro da semana da meta' });
    }
    const maximo = body.maximo_gasto !== undefined ? parseValorBoleto(body.maximo_gasto) : Number(atual.maximo_gasto);
    if (maximo == null) {
      return res.status(400).json({ error: 'Máximo de gasto inválido' });
    }
    const semana = intervaloSemana(dataReferencia);
    const result = await pool.query(
      `UPDATE boletos_metas_gasto
       SET data_referencia = $1, semana_chave = $2, semana_inicio = $3, semana_fim = $4, maximo_gasto = $5, updated_at = CURRENT_TIMESTAMP
       WHERE id = $6
       RETURNING ${META_SELECT}`,
      [dataReferencia, semana.chave, semana.inicio, semana.fim, maximo, id]
    );
    res.json(enriquecerMeta(result.rows[0]));
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'Já existe meta para esta semana.' });
    }
    if (erroTabelaBoletos(error, res)) return;
    console.error('Erro ao atualizar meta:', error);
    res.status(500).json({ error: 'Erro ao atualizar meta de gasto' });
  }
});

app.delete('/api/boletos/metas/:id', authenticateToken, requireModuloBoletos, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      return res.status(400).json({ error: 'id inválido' });
    }
    const existing = await pool.query('SELECT restaurante_id FROM boletos_metas_gasto WHERE id = $1', [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Meta não encontrada' });
    }
    const pode = await assertBoletosAcessoRestaurante(req, res, existing.rows[0].restaurante_id);
    if (!pode) return;
    await pool.query('DELETE FROM boletos_metas_gasto WHERE id = $1', [id]);
    res.json({ message: 'Meta removida', id });
  } catch (error) {
    if (erroTabelaBoletos(error, res)) return;
    console.error('Erro ao remover meta:', error);
    res.status(500).json({ error: 'Erro ao remover meta de gasto' });
  }
});

// ========== Admin: permissões por módulo ==========

async function listarRestauranteIdsUsuario(userId, db = pool) {
  const assoc = await db.query(
    'SELECT restaurante_id FROM usuario_restaurante_estoque WHERE usuario_id = $1 ORDER BY restaurante_id',
    [userId]
  );
  return assoc.rows.map((row) => row.restaurante_id);
}

async function sincronizarRestaurantesUsuario(client, userId, restauranteIds) {
  await client.query('DELETE FROM usuario_restaurante_estoque WHERE usuario_id = $1', [userId]);
  const ids = Array.isArray(restauranteIds)
    ? [...new Set(restauranteIds.map((x) => parseInt(x, 10)).filter((x) => !Number.isNaN(x)))]
    : [];
  for (const rid of ids) {
    const ex = await client.query('SELECT id FROM restaurantes WHERE id = $1 AND ativo = true', [rid]);
    if (ex.rows.length === 0) continue;
    await client.query(
      `INSERT INTO usuario_restaurante_estoque (usuario_id, restaurante_id) VALUES ($1, $2)
       ON CONFLICT (usuario_id, restaurante_id) DO NOTHING`,
      [userId, rid]
    );
  }
  return listarRestauranteIdsUsuario(userId, client);
}

app.get('/api/admin/usuarios-permissoes', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT u.id, u.username, u.nome, u.is_admin,
        COALESCE(u.modulo_financeiro, false) AS modulo_financeiro,
        COALESCE(u.modulo_estoque, false) AS modulo_estoque,
        COALESCE(u.modulo_estoque_simplificado, false) AS modulo_estoque_simplificado,
        COALESCE(u.modulo_boletos, false) AS modulo_boletos
       FROM usuarios u
       ORDER BY u.is_admin DESC, u.nome ASC`
    );
    const rows = [];
    for (const row of result.rows) {
      const flags = row.is_admin
        ? {
            ...row,
            modulo_financeiro: true,
            modulo_estoque: true,
            modulo_estoque_simplificado: true,
            modulo_boletos: true
          }
        : row;
      const restaurante_ids = await listarRestauranteIdsUsuario(row.id);
      rows.push({
        id: flags.id,
        username: flags.username,
        nome: flags.nome,
        is_admin: !!flags.is_admin,
        modulo_financeiro: !!flags.modulo_financeiro,
        modulo_estoque: !!flags.modulo_estoque,
        modulo_estoque_simplificado: !!flags.modulo_estoque_simplificado,
        modulo_boletos: !!flags.modulo_boletos,
        restaurante_ids
      });
    }
    res.json(rows);
  } catch (error) {
    if (error.code === '42703') {
      return res.status(503).json({ error: 'Migração de permissões pendente (013 ou 014).' });
    }
    console.error('Erro ao listar permissões:', error);
    res.status(500).json({ error: 'Erro ao listar permissões de usuários' });
  }
});

app.post('/api/admin/usuarios-permissoes', authenticateToken, requireAdmin, async (req, res) => {
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

    const moduloFinanceiro = body.modulo_financeiro === true;
    const moduloEstoque = body.modulo_estoque === true;
    const moduloEstoqueSimplificado = body.modulo_estoque_simplificado === true;
    const moduloBoletos = body.modulo_boletos === true;
    if (!moduloFinanceiro && !moduloEstoque && !moduloEstoqueSimplificado && !moduloBoletos) {
      return res.status(400).json({ error: 'Marque ao menos um módulo para o usuário.' });
    }

    const restrito = true; // todo usuário não-admin precisa de restaurantes liberados
    const restauranteIds = Array.isArray(body.restaurante_ids)
      ? body.restaurante_ids.map((x) => parseInt(x, 10)).filter((x) => !Number.isNaN(x))
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

    const somenteEstoqueLegacy = !moduloFinanceiro && (moduloEstoque || moduloEstoqueSimplificado);
    const hash = await bcrypt.hash(password, 10);
    await client.query('BEGIN');
    const ins = await client.query(
      `INSERT INTO usuarios (
         username, password, nome, is_admin, somente_estoque,
         modulo_financeiro, modulo_estoque, modulo_estoque_simplificado, modulo_boletos
       ) VALUES ($1, $2, $3, false, $4, $5, $6, $7, $8)
       RETURNING id, username, nome`,
      [
        username,
        hash,
        nome,
        somenteEstoqueLegacy,
        moduloFinanceiro,
        moduloEstoque,
        moduloEstoqueSimplificado,
        moduloBoletos
      ]
    );
    const newUser = ins.rows[0];
    let ids = [];
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
      modulo_financeiro: moduloFinanceiro,
      modulo_estoque: moduloEstoque,
      modulo_estoque_simplificado: moduloEstoqueSimplificado,
      modulo_boletos: moduloBoletos,
      restaurante_ids: ids
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (error.code === '42703') {
      return res.status(503).json({ error: 'Migração de permissões pendente (013 ou 014).' });
    }
    if (error.code === '23505') {
      return res.status(409).json({ error: 'Já existe usuário com este login.' });
    }
    console.error('Erro ao criar usuário:', error);
    res.status(500).json({ error: 'Erro ao criar usuário' });
  } finally {
    client.release();
  }
});

app.put('/api/admin/usuarios-permissoes/:id', authenticateToken, requireAdmin, async (req, res) => {
  const client = await pool.connect();
  try {
    const userId = parseInt(req.params.id, 10);
    if (Number.isNaN(userId)) {
      return res.status(400).json({ error: 'id inválido' });
    }
    const cur = await client.query('SELECT * FROM usuarios WHERE id = $1', [userId]);
    if (cur.rows.length === 0) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }
    const usuario = cur.rows[0];
    if (usuario.is_admin) {
      return res.status(400).json({ error: 'Permissões de administrador não podem ser alteradas.' });
    }

    const body = req.body || {};
    const moduloFinanceiro = body.modulo_financeiro === true;
    const moduloEstoque = body.modulo_estoque === true;
    const moduloEstoqueSimplificado = body.modulo_estoque_simplificado === true;
    const moduloBoletos = body.modulo_boletos === true;

    if (!moduloFinanceiro && !moduloEstoque && !moduloEstoqueSimplificado && !moduloBoletos) {
      return res.status(400).json({ error: 'Marque ao menos um módulo para o usuário.' });
    }

    const restrito = true; // todo usuário não-admin precisa de restaurantes liberados
    let restauranteIds = [];
    if (restrito) {
      restauranteIds = Array.isArray(body.restaurante_ids)
        ? body.restaurante_ids.map((x) => parseInt(x, 10)).filter((x) => !Number.isNaN(x))
        : await listarRestauranteIdsUsuario(userId);
      if (restauranteIds.length === 0) {
        return res.status(400).json({
          error: 'Usuário não-admin precisa de ao menos um restaurante liberado.'
        });
      }
    }

    const somenteEstoqueLegacy = !moduloFinanceiro && (moduloEstoque || moduloEstoqueSimplificado);

    await client.query('BEGIN');
    await client.query(
      `UPDATE usuarios
       SET modulo_financeiro = $1,
           modulo_estoque = $2,
           modulo_estoque_simplificado = $3,
           modulo_boletos = $4,
           somente_estoque = $5,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $6`,
      [moduloFinanceiro, moduloEstoque, moduloEstoqueSimplificado, moduloBoletos, somenteEstoqueLegacy, userId]
    );

    if (restrito) {
      restauranteIds = await sincronizarRestaurantesUsuario(client, userId, restauranteIds);
    } else {
      await client.query('DELETE FROM usuario_restaurante_estoque WHERE usuario_id = $1', [userId]);
      restauranteIds = [];
    }

    await client.query('COMMIT');

    res.json({
      id: userId,
      username: usuario.username,
      nome: usuario.nome,
      is_admin: false,
      modulo_financeiro: moduloFinanceiro,
      modulo_estoque: moduloEstoque,
      modulo_estoque_simplificado: moduloEstoqueSimplificado,
      modulo_boletos: moduloBoletos,
      restaurante_ids: restauranteIds
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (error.code === '42703') {
      return res.status(503).json({ error: 'Migração de permissões pendente (013 ou 014).' });
    }
    console.error('Erro ao atualizar permissões:', error);
    res.status(500).json({ error: 'Erro ao atualizar permissões' });
  } finally {
    client.release();
  }
});

app.delete('/api/admin/usuarios-permissoes/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const userId = parseInt(req.params.id, 10);
    if (Number.isNaN(userId)) {
      return res.status(400).json({ error: 'id inválido' });
    }
    if (userId === req.user.id) {
      return res.status(400).json({ error: 'Não é possível remover o próprio usuário.' });
    }
    const cur = await pool.query('SELECT id, is_admin FROM usuarios WHERE id = $1', [userId]);
    if (cur.rows.length === 0) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }
    if (cur.rows[0].is_admin) {
      return res.status(400).json({ error: 'Não é possível remover um administrador.' });
    }
    await pool.query('DELETE FROM usuarios WHERE id = $1', [userId]);
    res.json({ message: 'Usuário removido', id: userId });
  } catch (error) {
    if (error.code === '23503') {
      return res.status(409).json({
        error: 'Este usuário ainda está ligado a outros registros e não pode ser removido.'
      });
    }
    console.error('Erro ao remover usuário:', error);
    res.status(500).json({ error: 'Erro ao remover usuário' });
  }
});

// Health: liveness sem DB (evita 502 por timeout do proxy se o Postgres estiver inacessível)
function apiHealthLiveness(req, res) {
  res.status(200).json({
    status: 'ok',
    check: 'liveness',
    service: 'controle-financeiro-api',
    uptimeSeconds: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
    hint: 'GET /api/health/ready para testar conexão com o banco.'
  });
}

// Readiness: inclui SELECT 1 no Postgres
async function healthWithDatabase(req, res) {
  try {
    await pool.query('SELECT 1');
    res.status(200).json({
      status: 'ok',
      check: 'ready',
      database: 'connected',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(503).json({
      status: 'error',
      check: 'ready',
      database: 'disconnected',
      error: error.message
    });
  }
}

app.get('/api/health', apiHealthLiveness);
app.get('/api/health/ready', healthWithDatabase);
// Easypanel / probes antigos: mantém checagem com banco na raiz
app.get('/health', healthWithDatabase);

// Expõe o pool para os testes de integração encerrarem as conexões.
app.locals.pool = pool;

module.exports = app;

// Só escuta porta quando o arquivo é executado diretamente (npm start / node server.js)
if (require.main === module) {
  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`Servidor rodando na porta ${PORT}`);
    console.log('[boot] GET /api/health (liveness) | GET /api/health/ready (Postgres) | POST /api/login');
    if (process.env.LOG_HTTP !== '0' && process.env.LOG_HTTP !== 'false') {
      console.log('[boot] Log de cada requisição HTTP ativo — defina LOG_HTTP=0 para desligar');
    }
  });

  process.on('SIGTERM', () => {
    console.log('SIGTERM recebido, encerrando servidor graciosamente...');
    server.close(() => {
      console.log('Servidor encerrado');
      pool.end(() => {
        console.log('Pool de conexões fechado');
        process.exit(0);
      });
    });
  });

  process.on('SIGINT', () => {
    console.log('SIGINT recebido, encerrando servidor graciosamente...');
    server.close(() => {
      console.log('Servidor encerrado');
      pool.end(() => {
        console.log('Pool de conexões fechado');
        process.exit(0);
      });
    });
  });

  process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  });

  process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    process.exit(1);
  });
}
