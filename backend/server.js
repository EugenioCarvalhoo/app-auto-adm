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
  parseEstoqueQuantidadeInt,
  normalizeQuantidadeInt
} = require('./lib/estoqueQuantidade');
const {
  intervaloSemana,
  normalizarTipo,
  vencimentoEfetivo,
  grupoSemana
} = require('./lib/boletosSemana');

const MAX_ESTOQUE_FOTO_URL_LEN = 400000;

/** Usuários com somente_estoque=true não acessam rotas financeiras (gastos). */
const requireFinanceiroAccess = async (req, res, next) => {
  const flags = await loadUserFlags(req.user.id);
  if (!flags) {
    return res.status(403).json({ error: 'Usuário inválido.' });
  }
  if (flags.is_admin || flags.modulo_financeiro) {
    return next();
  }
  return res.status(403).json({ error: 'Sem permissão para o módulo financeiro.' });
};

const requireModuloEstoque = async (req, res, next) => {
  const flags = await loadUserFlags(req.user.id);
  if (!flags) {
    return res.status(403).json({ error: 'Usuário inválido.' });
  }
  if (flags.is_admin || flags.modulo_estoque) {
    return next();
  }
  return res.status(403).json({ error: 'Sem permissão para o módulo de estoque.' });
};

const requireModuloEstoqueSimplificado = async (req, res, next) => {
  const flags = await loadUserFlags(req.user.id);
  if (!flags) {
    return res.status(403).json({ error: 'Usuário inválido.' });
  }
  if (flags.is_admin || flags.modulo_estoque_simplificado) {
    return next();
  }
  return res.status(403).json({ error: 'Sem permissão para o lançamento diário de estoque.' });
};

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

function usuarioRestaurantesRestritos(flags) {
  return (
    !flags.is_admin &&
    !flags.modulo_financeiro &&
    (flags.modulo_estoque || flags.modulo_estoque_simplificado || flags.modulo_boletos)
  );
}

async function restauranteIdsUsuarioEstoque(userId) {
  const r = await pool.query(
    'SELECT restaurante_id FROM usuario_restaurante_estoque WHERE usuario_id = $1 ORDER BY restaurante_id',
    [userId]
  );
  return r.rows.map((row) => row.restaurante_id);
}

async function usuarioSomenteEstoquePodeRestaurante(userId, restauranteId) {
  const r = await pool.query(
    'SELECT 1 FROM usuario_restaurante_estoque WHERE usuario_id = $1 AND restaurante_id = $2',
    [userId, restauranteId]
  );
  return r.rows.length > 0;
}

/** Admin e usuários financeiros: qualquer restaurante. Somente estoque: só vinculados. */
async function assertEstoqueAcessoRestaurante(req, res, restauranteId) {
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
  if (flags.is_admin || flags.modulo_financeiro) {
    return true;
  }
  if (flags.modulo_estoque || flags.modulo_estoque_simplificado) {
    const ok = await usuarioSomenteEstoquePodeRestaurante(req.user.id, rid);
    if (!ok) {
      res.status(403).json({ error: 'Sem permissão para acessar o estoque deste restaurante.' });
      return false;
    }
    return true;
  }
  res.status(403).json({ error: 'Sem permissão para acessar estoque.' });
  return false;
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
  if (flags.is_admin || flags.modulo_financeiro) return true;
  const ok = await usuarioSomenteEstoquePodeRestaurante(req.user.id, rid);
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

function parseValorBoleto(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw) || raw < 0) return null;
    return Math.round(raw * 100) / 100;
  }
  const text = String(raw).trim().replace(/\s/g, '').replace(/^R\$/i, '');
  if (!text) return null;
  const normalized = text.includes(',') ? text.replace(/\./g, '').replace(',', '.') : text;
  const value = Number(normalized);
  if (!Number.isFinite(value) || value < 0) return null;
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

function parseTipoMovimento(tipoRaw) {
  const t = String(tipoRaw || '').trim().toLowerCase();
  if (t === 'entrada' || t === 'saida' || t === 'ajuste' || t === 'estorno') return t;
  return null;
}

async function inserirMovimentoEstoque(
  client,
  { produtoId, restauranteId, usuarioId, antes, depois, tipo = null, observacao = null, movimentoEstornoDeId = null }
) {
  const a = normalizeQuantidadeInt(antes);
  const d = normalizeQuantidadeInt(depois);
  const dif = d - a;
  if (dif === 0) return;
  const tipoMov = parseTipoMovimento(tipo) || (dif >= 0 ? 'entrada' : 'saida');
  const quantidade = Math.abs(dif);
  await client.query(
    `INSERT INTO estoque_movimentos (
      produto_id, restaurante_id, usuario_id, quantidade_antes, quantidade_depois, diferenca, tipo, quantidade, observacao, movimento_estorno_de_id
    )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NULLIF($9, ''), $10)
     RETURNING *`,
    [produtoId, restauranteId, usuarioId || null, a, d, dif, tipoMov, quantidade, observacao || null, movimentoEstornoDeId]
  );
}

function parseDateOnly(s) {
  if (!s || typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T12:00:00`);
  return Number.isNaN(d.getTime()) ? null : s;
}

function parseDataEntradaLancamentoDiario(s) {
  if (!s || typeof s !== 'string') return null;
  const t = s.trim();
  if (!t) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return parseDateOnly(t);
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(t)) {
    const [dia, mes, ano] = t.split('/');
    return parseDateOnly(`${ano}-${mes.padStart(2, '0')}-${dia.padStart(2, '0')}`);
  }
  return null;
}

/** Segunda-feira 00:00 até domingo (fim inclusivo como data) da semana que contém `ref` */
function periodoSemanaContendo(ref = new Date()) {
  const d = new Date(ref);
  d.setHours(12, 0, 0, 0);
  const dow = d.getDay();
  const diff = dow === 0 ? -6 : 1 - dow;
  const seg = new Date(d);
  seg.setDate(d.getDate() + diff);
  seg.setHours(0, 0, 0, 0);
  const dom = new Date(seg);
  dom.setDate(seg.getDate() + 6);
  const pad = (n) => String(n).padStart(2, '0');
  const iso = (x) =>
    `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
  return { data_inicio: iso(seg), data_fim: iso(dom) };
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
      const ok = await usuarioSomenteEstoquePodeRestaurante(req.user.id, rid);
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
app.post('/api/restaurantes', authenticateToken, requireFinanceiroAccess, async (req, res) => {
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
app.put('/api/restaurantes/:id', authenticateToken, requireFinanceiroAccess, async (req, res) => {
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
app.delete('/api/restaurantes/:id', authenticateToken, requireFinanceiroAccess, async (req, res) => {
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

// Get all expenses (now filtered by restaurante_id if provided)
app.get('/api/gastos', authenticateToken, requireFinanceiroAccess, async (req, res) => {
  try {
    const { restaurante_id } = req.query;
    let query = 'SELECT * FROM gastos';
    const params = [];
    
    if (restaurante_id) {
      query += ' WHERE restaurante_id = $1';
      params.push(restaurante_id);
    }
    
    query += ' ORDER BY data DESC, id DESC';
    
    const result = await pool.query(query, params);
    // Formatar datas para evitar problemas de timezone
    const gastosFormatados = result.rows.map(gasto => {
      let dataFormatada = gasto.data;
      if (gasto.data) {
        // Se já é string no formato YYYY-MM-DD, usar diretamente
        if (typeof gasto.data === 'string' && gasto.data.match(/^\d{4}-\d{2}-\d{2}$/)) {
          dataFormatada = gasto.data;
        } else if (typeof gasto.data === 'string' && gasto.data.match(/^\d{4}-\d{2}-\d{2}T/)) {
          // Se é ISO string, extrair apenas a parte da data antes do T
          dataFormatada = gasto.data.split('T')[0];
        } else {
          // Caso contrário (objeto Date), extrair a data local (não UTC)
          const date = new Date(gasto.data);
          // Usar métodos locais para preservar o dia correto
          const ano = date.getFullYear();
          const mes = String(date.getMonth() + 1).padStart(2, '0');
          const dia = String(date.getDate()).padStart(2, '0');
          dataFormatada = `${ano}-${mes}-${dia}`;
        }
      }
      return {
        ...gasto,
        data: dataFormatada
      };
    });
    res.json(gastosFormatados);
  } catch (error) {
    console.error('Erro ao buscar gastos:', error);
    res.status(500).json({ error: 'Erro ao buscar gastos' });
  }
});

// Get single expense
app.get('/api/gastos/:id', authenticateToken, requireFinanceiroAccess, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('SELECT * FROM gastos WHERE id = $1', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Gasto não encontrado' });
    }
    // Formatar data para evitar problemas de timezone
    let dataFormatada = result.rows[0].data;
    if (result.rows[0].data) {
      if (typeof result.rows[0].data === 'string' && result.rows[0].data.match(/^\d{4}-\d{2}-\d{2}$/)) {
        dataFormatada = result.rows[0].data;
      } else if (typeof result.rows[0].data === 'string' && result.rows[0].data.match(/^\d{4}-\d{2}-\d{2}T/)) {
        // Se é ISO string, extrair apenas a parte da data
        dataFormatada = result.rows[0].data.split('T')[0];
      } else {
        // Caso contrário (objeto Date), extrair a data local
        const date = new Date(result.rows[0].data);
        const ano = date.getFullYear();
        const mes = String(date.getMonth() + 1).padStart(2, '0');
        const dia = String(date.getDate()).padStart(2, '0');
        dataFormatada = `${ano}-${mes}-${dia}`;
      }
    }
    const gastoFormatado = {
      ...result.rows[0],
      data: dataFormatada
    };
    res.json(gastoFormatado);
  } catch (error) {
    console.error('Erro ao buscar gasto:', error);
    res.status(500).json({ error: 'Erro ao buscar gasto' });
  }
});

// Create expense
app.post('/api/gastos', authenticateToken, requireFinanceiroAccess, async (req, res) => {
  try {
    const { data, descricao, valor, observacao, pago, retroativo, restaurante_id } = req.body;
    
    if (!restaurante_id) {
      return res.status(400).json({ error: 'restaurante_id é obrigatório' });
    }
    
    const result = await pool.query(
      'INSERT INTO gastos (data, descricao, valor, observacao, pago, retroativo, restaurante_id) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *',
      [data, descricao, valor || null, observacao || null, pago || false, retroativo || false, restaurante_id]
    );
    // Formatar data para evitar problemas de timezone
    let dataFormatada = result.rows[0].data;
    if (result.rows[0].data) {
      if (typeof result.rows[0].data === 'string' && result.rows[0].data.match(/^\d{4}-\d{2}-\d{2}$/)) {
        dataFormatada = result.rows[0].data;
      } else if (typeof result.rows[0].data === 'string' && result.rows[0].data.match(/^\d{4}-\d{2}-\d{2}T/)) {
        // Se é ISO string, extrair apenas a parte da data
        dataFormatada = result.rows[0].data.split('T')[0];
      } else {
        // Caso contrário (objeto Date), extrair a data local
        const date = new Date(result.rows[0].data);
        const ano = date.getFullYear();
        const mes = String(date.getMonth() + 1).padStart(2, '0');
        const dia = String(date.getDate()).padStart(2, '0');
        dataFormatada = `${ano}-${mes}-${dia}`;
      }
    }
    const gastoFormatado = {
      ...result.rows[0],
      data: dataFormatada
    };
    res.status(201).json(gastoFormatado);
  } catch (error) {
    console.error('Erro ao criar gasto:', error);
    res.status(500).json({ error: 'Erro ao criar gasto' });
  }
});

// Update expense
app.put('/api/gastos/:id', authenticateToken, requireFinanceiroAccess, async (req, res) => {
  try {
    const { id } = req.params;
    const { data, descricao, valor, observacao, pago, retroativo, restaurante_id } = req.body;
    const result = await pool.query(
      'UPDATE gastos SET data = $1, descricao = $2, valor = $3, observacao = $4, pago = $5, retroativo = $6, restaurante_id = $7 WHERE id = $8 RETURNING *',
      [data, descricao, valor || null, observacao || null, pago || false, retroativo || false, restaurante_id, id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Gasto não encontrado' });
    }
    // Formatar data para evitar problemas de timezone
    let dataFormatada = result.rows[0].data;
    if (result.rows[0].data) {
      if (typeof result.rows[0].data === 'string' && result.rows[0].data.match(/^\d{4}-\d{2}-\d{2}$/)) {
        dataFormatada = result.rows[0].data;
      } else if (typeof result.rows[0].data === 'string' && result.rows[0].data.match(/^\d{4}-\d{2}-\d{2}T/)) {
        // Se é ISO string, extrair apenas a parte da data
        dataFormatada = result.rows[0].data.split('T')[0];
      } else {
        // Caso contrário (objeto Date), extrair a data local
        const date = new Date(result.rows[0].data);
        const ano = date.getFullYear();
        const mes = String(date.getMonth() + 1).padStart(2, '0');
        const dia = String(date.getDate()).padStart(2, '0');
        dataFormatada = `${ano}-${mes}-${dia}`;
      }
    }
    const gastoFormatado = {
      ...result.rows[0],
      data: dataFormatada
    };
    res.json(gastoFormatado);
  } catch (error) {
    console.error('Erro ao atualizar gasto:', error);
    res.status(500).json({ error: 'Erro ao atualizar gasto' });
  }
});

// Delete expense
app.delete('/api/gastos/:id', authenticateToken, requireFinanceiroAccess, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('DELETE FROM gastos WHERE id = $1 RETURNING *', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Gasto não encontrado' });
    }
    res.json({ message: 'Gasto deletado com sucesso' });
  } catch (error) {
    console.error('Erro ao deletar gasto:', error);
    res.status(500).json({ error: 'Erro ao deletar gasto' });
  }
});

// Bulk update (for grid editing)
app.put('/api/gastos/bulk', authenticateToken, requireFinanceiroAccess, async (req, res) => {
  try {
    const { gastos } = req.body;
    const client = await pool.connect();
    
    try {
      await client.query('BEGIN');
      
      for (const gasto of gastos) {
        if (gasto.id) {
          // Update existing
          await client.query(
            'UPDATE gastos SET data = $1, descricao = $2, valor = $3, observacao = $4, pago = $5, retroativo = $6, restaurante_id = $7 WHERE id = $8',
            [gasto.data, gasto.descricao, gasto.valor || null, gasto.observacao || null, gasto.pago || false, gasto.retroativo || false, gasto.restaurante_id, gasto.id]
          );
        } else {
          // Insert new - restaurante_id é obrigatório
          if (!gasto.restaurante_id) {
            throw new Error('restaurante_id é obrigatório para novos gastos');
          }
          await client.query(
            'INSERT INTO gastos (data, descricao, valor, observacao, pago, retroativo, restaurante_id) VALUES ($1, $2, $3, $4, $5, $6, $7)',
            [gasto.data, gasto.descricao, gasto.valor || null, gasto.observacao || null, gasto.pago || false, gasto.retroativo || false, gasto.restaurante_id]
          );
        }
      }
      
      await client.query('COMMIT');
      res.json({ message: 'Gastos atualizados com sucesso' });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Erro ao atualizar gastos em lote:', error);
    res.status(500).json({ error: 'Erro ao atualizar gastos em lote' });
  }
});

// ========== Módulo Estoque ==========

// Lista categorias + produtos agrupados (todos autenticados)
app.get('/api/estoque/agrupado', authenticateToken, requireModuloEstoque, async (req, res) => {
  try {
    const { restaurante_id } = req.query;
    if (!restaurante_id) {
      return res.status(400).json({ error: 'restaurante_id é obrigatório' });
    }
    const rid = parseInt(restaurante_id, 10);
    if (Number.isNaN(rid)) {
      return res.status(400).json({ error: 'restaurante_id inválido' });
    }

    const pode = await assertEstoqueAcessoRestaurante(req, res, rid);
    if (!pode) return;

    const catResult = await pool.query(
      `SELECT id, restaurante_id, nome, ordem
       FROM estoque_categorias
       WHERE restaurante_id = $1
       ORDER BY ordem ASC, nome ASC`,
      [rid]
    );

    const sqlProdutosCompleto = `SELECT p.id, p.restaurante_id, p.categoria_id, p.nome, p.unidade, p.quantidade,
              p.quantidade_critica, p.foto_url, p.created_at, p.updated_at
       FROM estoque_produtos p
       WHERE p.restaurante_id = $1
       ORDER BY p.nome ASC`;
    const sqlProdutosLegado = `SELECT p.id, p.restaurante_id, p.categoria_id, p.nome, p.unidade, p.quantidade,
              p.created_at, p.updated_at
       FROM estoque_produtos p
       WHERE p.restaurante_id = $1
       ORDER BY p.nome ASC`;

    let prodResult;
    try {
      prodResult = await pool.query(sqlProdutosCompleto, [rid]);
    } catch (err) {
      if (err.code === '42703') {
        console.warn(
          '[estoque/agrupado] Colunas quantidade_critica/foto_url ausentes — rode a migração 011. Usando SELECT legado.'
        );
        prodResult = await pool.query(sqlProdutosLegado, [rid]);
      } else {
        throw err;
      }
    }

    const produtosPorCat = {};
    prodResult.rows.forEach((p) => {
      if (!produtosPorCat[p.categoria_id]) produtosPorCat[p.categoria_id] = [];
      const qn = Math.max(0, Math.round(Number(p.quantidade)) || 0);
      const qc =
        p.quantidade_critica !== undefined && p.quantidade_critica !== null
          ? Math.max(0, Math.round(Number(p.quantidade_critica)) || 0)
          : 0;
      const foto =
        p.foto_url !== undefined && p.foto_url !== null && String(p.foto_url).trim() !== ''
          ? String(p.foto_url).trim()
          : null;
      produtosPorCat[p.categoria_id].push({
        ...p,
        quantidade: qn,
        quantidade_critica: qc,
        foto_url: foto
      });
    });

    const categorias = catResult.rows.map((c) => ({
      ...c,
      produtos: produtosPorCat[c.id] || []
    }));

    res.json({ restaurante_id: rid, categorias });
  } catch (error) {
    console.error('Erro ao listar estoque agrupado:', error);
    res.status(500).json({ error: 'Erro ao listar estoque' });
  }
});

// CRUD categorias (somente admin)
app.post('/api/estoque/categorias', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { restaurante_id, nome, ordem } = req.body;
    if (!restaurante_id || !nome || String(nome).trim() === '') {
      return res.status(400).json({ error: 'restaurante_id e nome são obrigatórios' });
    }
    const result = await pool.query(
      `INSERT INTO estoque_categorias (restaurante_id, nome, ordem)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [restaurante_id, String(nome).trim(), ordem !== undefined ? ordem : 0]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'Já existe uma categoria com este nome neste restaurante.' });
    }
    console.error('Erro ao criar categoria:', error);
    res.status(500).json({ error: 'Erro ao criar categoria' });
  }
});

app.put('/api/estoque/categorias/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { nome, ordem } = req.body;
    if (!nome || String(nome).trim() === '') {
      return res.status(400).json({ error: 'nome é obrigatório' });
    }
    const result = await pool.query(
      `UPDATE estoque_categorias
       SET nome = $1, ordem = COALESCE($2, ordem), updated_at = CURRENT_TIMESTAMP
       WHERE id = $3
       RETURNING *`,
      [String(nome).trim(), ordem, id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Categoria não encontrada' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Erro ao atualizar categoria:', error);
    res.status(500).json({ error: 'Erro ao atualizar categoria' });
  }
});

app.delete('/api/estoque/categorias/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('DELETE FROM estoque_categorias WHERE id = $1 RETURNING *', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Categoria não encontrada' });
    }
    res.json({ message: 'Categoria removida', id: result.rows[0].id });
  } catch (error) {
    console.error('Erro ao remover categoria:', error);
    res.status(500).json({ error: 'Erro ao remover categoria' });
  }
});

// CRUD produtos
app.post('/api/estoque/produtos', authenticateToken, requireAdmin, async (req, res) => {
  const { restaurante_id, categoria_id, nome, unidade, quantidade, quantidade_critica, foto_url } = req.body;
  if (!restaurante_id || !categoria_id || !nome || String(nome).trim() === '') {
    return res.status(400).json({ error: 'restaurante_id, categoria_id e nome são obrigatórios' });
  }
  const un = unidade && String(unidade).trim() !== '' ? String(unidade).trim().slice(0, 20) : 'un';
  const qParsed = parseEstoqueQuantidadeInt(
    quantidade !== undefined && quantidade !== null ? quantidade : 0
  );
  if (!qParsed.ok) {
    return res.status(400).json({ error: qParsed.error });
  }
  const qtd = qParsed.value;
  const critParsed = parseEstoqueQuantidadeInt(
    quantidade_critica !== undefined && quantidade_critica !== null ? quantidade_critica : 0
  );
  if (!critParsed.ok) {
    return res.status(400).json({ error: 'quantidade_critica inválida' });
  }
  const critica = critParsed.value;
  let fotoVal = null;
  if (foto_url != null && String(foto_url).trim() !== '') {
    const fs = String(foto_url).trim();
    if (fs.length > MAX_ESTOQUE_FOTO_URL_LEN) {
      return res.status(400).json({ error: 'Imagem ou URL muito grande. Reduza o tamanho ou use um link.' });
    }
    fotoVal = fs;
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `INSERT INTO estoque_produtos (restaurante_id, categoria_id, nome, unidade, quantidade, quantidade_critica, foto_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [restaurante_id, categoria_id, String(nome).trim(), un, qtd, critica, fotoVal]
    );
    const row = result.rows[0];
    if (qtd > 0) {
      await inserirMovimentoEstoque(client, {
        produtoId: row.id,
        restauranteId: row.restaurante_id,
        usuarioId: req.user.id,
        antes: 0,
        depois: qtd
      });
    }
    await client.query('COMMIT');
    res.status(201).json(row);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (error.code === '23505') {
      return res.status(409).json({ error: 'Já existe um produto com este nome nesta categoria.' });
    }
    console.error('Erro ao criar produto:', error);
    res.status(500).json({ error: 'Erro ao criar produto' });
  } finally {
    client.release();
  }
});

app.put('/api/estoque/produtos/:id', authenticateToken, requireModuloEstoque, async (req, res) => {
  const { id } = req.params;
  const body = req.body || {};
  const isAdmin = !!req.user.is_admin;

  const existing = await pool.query('SELECT * FROM estoque_produtos WHERE id = $1', [id]);
  if (existing.rows.length === 0) {
    return res.status(404).json({ error: 'Produto não encontrado' });
  }

  const rowRestId = existing.rows[0].restaurante_id;
  const pode = await assertEstoqueAcessoRestaurante(req, res, rowRestId);
  if (!pode) return;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const locked = await client.query('SELECT * FROM estoque_produtos WHERE id = $1 FOR UPDATE', [id]);
    const row = locked.rows[0];
    const antes = normalizeQuantidadeInt(row.quantidade);

    if (isAdmin) {
      const categoria_id = body.categoria_id !== undefined ? body.categoria_id : row.categoria_id;
      const nome =
        body.nome !== undefined && String(body.nome).trim() !== ''
          ? String(body.nome).trim()
          : row.nome;
      const unidade =
        body.unidade !== undefined && String(body.unidade).trim() !== ''
          ? String(body.unidade).trim().slice(0, 20)
          : row.unidade;
      let quantidadeVal = antes;
      if (body.quantidade !== undefined && body.quantidade !== null) {
        const qp = parseEstoqueQuantidadeInt(body.quantidade);
        if (!qp.ok) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: qp.error });
        }
        quantidadeVal = qp.value;
      }
      let criticaVal = normalizeQuantidadeInt(row.quantidade_critica);
      if (body.quantidade_critica !== undefined && body.quantidade_critica !== null) {
        const cp = parseEstoqueQuantidadeInt(body.quantidade_critica);
        if (!cp.ok) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: cp.error });
        }
        criticaVal = cp.value;
      }
      let fotoVal = row.foto_url || null;
      if (body.foto_url !== undefined) {
        if (body.foto_url === null || body.foto_url === '') {
          fotoVal = null;
        } else {
          const fs = String(body.foto_url).trim();
          if (fs.length > MAX_ESTOQUE_FOTO_URL_LEN) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'Imagem ou URL muito grande. Reduza o tamanho ou use um link.' });
          }
          fotoVal = fs;
        }
      }
      const result = await client.query(
        `UPDATE estoque_produtos
         SET categoria_id = $1, nome = $2, unidade = $3, quantidade = $4,
             quantidade_critica = $5, foto_url = $6, updated_at = CURRENT_TIMESTAMP
         WHERE id = $7
         RETURNING *`,
        [categoria_id, nome, unidade, quantidadeVal, criticaVal, fotoVal, id]
      );
      await inserirMovimentoEstoque(client, {
        produtoId: Number(id),
        restauranteId: row.restaurante_id,
        usuarioId: req.user.id,
        antes,
        depois: quantidadeVal,
        tipo: 'ajuste'
      });
      await client.query('COMMIT');
      return res.json(result.rows[0]);
    }

    if (body.quantidade === undefined || body.quantidade === null) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Informe quantidade para atualizar.' });
    }
    const qp = parseEstoqueQuantidadeInt(body.quantidade);
    if (!qp.ok) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: qp.error });
    }
    const depois = qp.value;
    const result = await client.query(
      `UPDATE estoque_produtos SET quantidade = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *`,
      [depois, id]
    );
    await inserirMovimentoEstoque(client, {
      produtoId: Number(id),
      restauranteId: row.restaurante_id,
      usuarioId: req.user.id,
      antes,
      depois,
      tipo: 'ajuste'
    });
    await client.query('COMMIT');
    res.json(result.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Erro ao atualizar produto:', error);
    res.status(500).json({ error: 'Erro ao atualizar produto' });
  } finally {
    client.release();
  }
});

app.delete('/api/estoque/produtos/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('DELETE FROM estoque_produtos WHERE id = $1 RETURNING *', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Produto não encontrado' });
    }
    res.json({ message: 'Produto removido', id: result.rows[0].id });
  } catch (error) {
    console.error('Erro ao remover produto:', error);
    res.status(500).json({ error: 'Erro ao remover produto' });
  }
});

async function resolverCategoriaDestinoReplicar(client, destinoId, categoriaNome, categoriaOrdem, catMap, criarCats) {
  const nomeNorm = String(categoriaNome).trim();
  if (catMap.has(nomeNorm)) {
    return catMap.get(nomeNorm);
  }
  const existing = await client.query(
    'SELECT id FROM estoque_categorias WHERE restaurante_id = $1 AND nome = $2',
    [destinoId, nomeNorm]
  );
  if (existing.rows.length > 0) {
    const id = existing.rows[0].id;
    catMap.set(nomeNorm, id);
    return id;
  }
  if (!criarCats) {
    return null;
  }
  try {
    const ins = await client.query(
      'INSERT INTO estoque_categorias (restaurante_id, nome, ordem) VALUES ($1, $2, $3) RETURNING id',
      [destinoId, nomeNorm, categoriaOrdem !== undefined && categoriaOrdem !== null ? categoriaOrdem : 0]
    );
    const id = ins.rows[0].id;
    catMap.set(nomeNorm, id);
    return id;
  } catch (err) {
    if (err.code === '23505') {
      const r2 = await client.query(
        'SELECT id FROM estoque_categorias WHERE restaurante_id = $1 AND nome = $2',
        [destinoId, nomeNorm]
      );
      if (r2.rows.length === 0) throw err;
      const id = r2.rows[0].id;
      catMap.set(nomeNorm, id);
      return id;
    }
    throw err;
  }
}

app.post('/api/estoque/produtos/replicar', authenticateToken, requireAdmin, async (req, res) => {
  const {
    origem_restaurante_id,
    destino_restaurante_ids,
    produto_ids,
    criar_categorias_ausentes,
    copiar_quantidade
  } = req.body || {};

  const origemId = parseInt(origem_restaurante_id, 10);
  if (Number.isNaN(origemId)) {
    return res.status(400).json({ error: 'origem_restaurante_id inválido' });
  }
  if (!Array.isArray(destino_restaurante_ids) || destino_restaurante_ids.length === 0) {
    return res.status(400).json({ error: 'Informe ao menos um restaurante de destino.' });
  }

  const destinos = [
    ...new Set(
      destino_restaurante_ids
        .map((id) => parseInt(id, 10))
        .filter((id) => !Number.isNaN(id) && id !== origemId)
    )
  ];
  if (destinos.length === 0) {
    return res.status(400).json({ error: 'Informe restaurantes de destino válidos (diferentes da origem).' });
  }

  const criarCats = criar_categorias_ausentes !== false;
  const copiarQtd = copiar_quantidade === true;

  const restCheck = await pool.query('SELECT id FROM restaurantes WHERE id = $1', [origemId]);
  if (restCheck.rows.length === 0) {
    return res.status(404).json({ error: 'Restaurante de origem não encontrado.' });
  }

  const destCheck = await pool.query('SELECT id FROM restaurantes WHERE id = ANY($1::int[])', [destinos]);
  if (destCheck.rows.length !== destinos.length) {
    return res.status(400).json({ error: 'Um ou mais restaurantes de destino não existem.' });
  }

  let prodFilter = '';
  const prodParams = [origemId];
  if (Array.isArray(produto_ids) && produto_ids.length > 0) {
    const ids = produto_ids.map((id) => parseInt(id, 10)).filter((id) => !Number.isNaN(id));
    if (ids.length === 0) {
      return res.status(400).json({ error: 'produto_ids inválidos.' });
    }
    prodFilter = ' AND p.id = ANY($2::int[])';
    prodParams.push(ids);
  }

  const sqlProdutosCompleto = `SELECT p.id, p.restaurante_id, p.nome, p.unidade, p.quantidade,
         p.quantidade_critica, p.foto_url, c.nome AS categoria_nome, c.ordem AS categoria_ordem
       FROM estoque_produtos p
       INNER JOIN estoque_categorias c ON c.id = p.categoria_id
       WHERE p.restaurante_id = $1${prodFilter}
       ORDER BY c.ordem ASC, c.nome ASC, p.nome ASC`;
  const sqlProdutosLegado = `SELECT p.id, p.restaurante_id, p.nome, p.unidade, p.quantidade,
         c.nome AS categoria_nome, c.ordem AS categoria_ordem
       FROM estoque_produtos p
       INNER JOIN estoque_categorias c ON c.id = p.categoria_id
       WHERE p.restaurante_id = $1${prodFilter}
       ORDER BY c.ordem ASC, c.nome ASC, p.nome ASC`;

  let prodResult;
  try {
    prodResult = await pool.query(sqlProdutosCompleto, prodParams);
  } catch (err) {
    if (err.code === '42703') {
      prodResult = await pool.query(sqlProdutosLegado, prodParams);
    } else {
      throw err;
    }
  }

  const produtosOrigem = prodResult.rows;
  if (produtosOrigem.length === 0) {
    return res.status(400).json({ error: 'Nenhum produto encontrado na origem para replicar.' });
  }

  const resumo = {
    criados: 0,
    ignorados_duplicata: 0,
    ignorados_categoria_ausente: 0,
    categorias_criadas: 0,
    detalhes: []
  };

  const client = await pool.connect();
  try {
    for (const destinoId of destinos) {
      await client.query('BEGIN');
      const catMap = new Map();
      const catsDest = await client.query(
        'SELECT id, nome FROM estoque_categorias WHERE restaurante_id = $1',
        [destinoId]
      );
      catsDest.rows.forEach((c) => catMap.set(String(c.nome).trim(), c.id));
      const catsAntes = catMap.size;

      for (const src of produtosOrigem) {
        const categoriaId = await resolverCategoriaDestinoReplicar(
          client,
          destinoId,
          src.categoria_nome,
          src.categoria_ordem,
          catMap,
          criarCats
        );
        if (!categoriaId) {
          resumo.ignorados_categoria_ausente += 1;
          resumo.detalhes.push({
            destino_restaurante_id: destinoId,
            produto_origem_id: src.id,
            produto_nome: src.nome,
            status: 'categoria_ausente'
          });
          continue;
        }

        const un = src.unidade && String(src.unidade).trim() !== '' ? String(src.unidade).trim().slice(0, 20) : 'un';
        const qtd = copiarQtd ? Math.max(0, Math.round(Number(src.quantidade)) || 0) : 0;
        const critica =
          src.quantidade_critica !== undefined && src.quantidade_critica !== null
            ? Math.max(0, Math.round(Number(src.quantidade_critica)) || 0)
            : 0;
        let fotoVal = null;
        if (src.foto_url != null && String(src.foto_url).trim() !== '') {
          const fs = String(src.foto_url).trim();
          if (fs.length <= MAX_ESTOQUE_FOTO_URL_LEN) {
            fotoVal = fs;
          }
        }

        try {
          const ins = await client.query(
            `INSERT INTO estoque_produtos (restaurante_id, categoria_id, nome, unidade, quantidade, quantidade_critica, foto_url)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             RETURNING id`,
            [destinoId, categoriaId, String(src.nome).trim(), un, qtd, critica, fotoVal]
          );
          const novoId = ins.rows[0].id;
          if (qtd > 0) {
            await inserirMovimentoEstoque(client, {
              produtoId: novoId,
              restauranteId: destinoId,
              usuarioId: req.user.id,
              antes: 0,
              depois: qtd
            });
          }
          resumo.criados += 1;
          resumo.detalhes.push({
            destino_restaurante_id: destinoId,
            produto_origem_id: src.id,
            produto_novo_id: novoId,
            produto_nome: src.nome,
            status: 'criado'
          });
        } catch (err) {
          if (err.code === '23505') {
            resumo.ignorados_duplicata += 1;
            resumo.detalhes.push({
              destino_restaurante_id: destinoId,
              produto_origem_id: src.id,
              produto_nome: src.nome,
              status: 'duplicata'
            });
          } else if (err.code === '42703') {
            const insLeg = await client.query(
              `INSERT INTO estoque_produtos (restaurante_id, categoria_id, nome, unidade, quantidade)
               VALUES ($1, $2, $3, $4, $5)
               RETURNING id`,
              [destinoId, categoriaId, String(src.nome).trim(), un, qtd]
            );
            const novoId = insLeg.rows[0].id;
            if (qtd > 0) {
              await inserirMovimentoEstoque(client, {
                produtoId: novoId,
                restauranteId: destinoId,
                usuarioId: req.user.id,
                antes: 0,
                depois: qtd
              });
            }
            resumo.criados += 1;
            resumo.detalhes.push({
              destino_restaurante_id: destinoId,
              produto_origem_id: src.id,
              produto_novo_id: novoId,
              produto_nome: src.nome,
              status: 'criado'
            });
          } else {
            throw err;
          }
        }
      }

      resumo.categorias_criadas += Math.max(0, catMap.size - catsAntes);
      await client.query('COMMIT');
    }

    res.json(resumo);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Erro ao replicar produtos:', error);
    res.status(500).json({ error: 'Erro ao replicar produtos' });
  } finally {
    client.release();
  }
});

// Lançamento explícito de entrada/saída (quantidade)
app.post('/api/estoque/produtos/:id/movimentar', authenticateToken, requireModuloEstoque, async (req, res) => {
  const produtoId = parseInt(req.params.id, 10);
  if (Number.isNaN(produtoId)) {
    return res.status(400).json({ error: 'id de produto inválido' });
  }
  const tipo = parseTipoMovimento(req.body?.tipo);
  if (tipo !== 'entrada' && tipo !== 'saida') {
    return res.status(400).json({ error: "tipo deve ser 'entrada' ou 'saida'" });
  }
  const qp = parseEstoqueQuantidadeInt(req.body?.quantidade);
  if (!qp.ok || qp.value <= 0) {
    return res.status(400).json({ error: 'quantidade deve ser inteiro maior que zero' });
  }
  const observacao = req.body?.observacao ? String(req.body.observacao).trim().slice(0, 300) : null;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const locked = await client.query('SELECT * FROM estoque_produtos WHERE id = $1 FOR UPDATE', [produtoId]);
    if (locked.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Produto não encontrado' });
    }
    const prod = locked.rows[0];
    const pode = await assertEstoqueAcessoRestaurante(req, res, prod.restaurante_id);
    if (!pode) {
      await client.query('ROLLBACK');
      return;
    }
    const antes = normalizeQuantidadeInt(prod.quantidade);
    const delta = tipo === 'entrada' ? qp.value : -qp.value;
    const depois = antes + delta;
    if (depois < 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Saída maior que o saldo atual do produto.' });
    }
    const upd = await client.query(
      'UPDATE estoque_produtos SET quantidade = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *',
      [depois, produtoId]
    );
    await inserirMovimentoEstoque(client, {
      produtoId,
      restauranteId: prod.restaurante_id,
      usuarioId: req.user.id,
      antes,
      depois,
      tipo,
      observacao
    });
    await client.query('COMMIT');
    res.json(upd.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Erro ao lançar movimentação:', error);
    res.status(500).json({ error: 'Erro ao lançar movimentação' });
  } finally {
    client.release();
  }
});

// Estorna um lançamento incorreto criando um movimento inverso
app.post('/api/estoque/movimentos/:id/estornar', authenticateToken, requireModuloEstoque, async (req, res) => {
  const movId = parseInt(req.params.id, 10);
  if (Number.isNaN(movId)) {
    return res.status(400).json({ error: 'id de movimento inválido' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const movRes = await client.query(
      `SELECT m.*, p.id AS produto_id_real
       FROM estoque_movimentos m
       INNER JOIN estoque_produtos p ON p.id = m.produto_id
       WHERE m.id = $1
       FOR UPDATE`,
      [movId]
    );
    if (movRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Movimento não encontrado' });
    }
    const mov = movRes.rows[0];
    const pode = await assertEstoqueAcessoRestaurante(req, res, mov.restaurante_id);
    if (!pode) {
      await client.query('ROLLBACK');
      return;
    }
    if (mov.estornado || mov.estornado_por_movimento_id) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Este lançamento já foi estornado.' });
    }
    if (mov.tipo === 'estorno') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Não é possível estornar um estorno.' });
    }

    const prodLock = await client.query('SELECT * FROM estoque_produtos WHERE id = $1 FOR UPDATE', [mov.produto_id]);
    if (prodLock.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Produto do movimento não encontrado.' });
    }
    const prod = prodLock.rows[0];
    const antes = normalizeQuantidadeInt(prod.quantidade);
    const difOriginal = parseInt(mov.diferenca, 10) || 0;
    const deltaInverso = -difOriginal;
    const depois = antes + deltaInverso;
    if (depois < 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Não é possível estornar: saldo atual insuficiente.' });
    }
    await client.query(
      'UPDATE estoque_produtos SET quantidade = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [depois, mov.produto_id]
    );
    const estornoIns = await client.query(
      `INSERT INTO estoque_movimentos (
        produto_id, restaurante_id, usuario_id, quantidade_antes, quantidade_depois, diferenca, tipo, quantidade, observacao, movimento_estorno_de_id
      ) VALUES ($1, $2, $3, $4, $5, $6, 'estorno', $7, $8, $9)
      RETURNING id`,
      [
        mov.produto_id,
        mov.restaurante_id,
        req.user.id,
        antes,
        depois,
        deltaInverso,
        Math.abs(deltaInverso),
        `Estorno do lançamento #${mov.id}`,
        mov.id
      ]
    );
    const estornoId = estornoIns.rows[0].id;
    await client.query(
      `UPDATE estoque_movimentos
       SET estornado = true, estornado_por_movimento_id = $1
       WHERE id = $2`,
      [estornoId, mov.id]
    );
    await client.query('COMMIT');
    res.json({ message: 'Lançamento estornado com sucesso.', movimento_estorno_id: estornoId });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Erro ao estornar movimento:', error);
    res.status(500).json({ error: 'Erro ao estornar movimento' });
  } finally {
    client.release();
  }
});

// Resumo entradas/saídas por período (padrão: semana atual, seg–dom)
app.get('/api/estoque/movimentos/resumo', authenticateToken, requireModuloEstoque, async (req, res) => {
  try {
    const rid = parseInt(req.query.restaurante_id, 10);
    if (Number.isNaN(rid)) {
      return res.status(400).json({ error: 'restaurante_id é obrigatório' });
    }
    const pode = await assertEstoqueAcessoRestaurante(req, res, rid);
    if (!pode) return;

    let dataInicio = parseDateOnly(req.query.data_inicio);
    let dataFim = parseDateOnly(req.query.data_fim);
    if (!dataInicio || !dataFim) {
      const w = periodoSemanaContendo();
      dataInicio = w.data_inicio;
      dataFim = w.data_fim;
    }
    if (dataInicio > dataFim) {
      return res.status(400).json({ error: 'data_inicio não pode ser maior que data_fim' });
    }

    const produtoId = req.query.produto_id ? parseInt(req.query.produto_id, 10) : null;
    if (req.query.produto_id && Number.isNaN(produtoId)) {
      return res.status(400).json({ error: 'produto_id inválido' });
    }

    let where = `m.restaurante_id = $1
      AND m.created_at::date >= $2::date
      AND m.created_at::date <= $3::date`;
    const paramsBase = [rid, dataInicio, dataFim];
    if (produtoId) {
      where += ' AND m.produto_id = $4';
      paramsBase.push(produtoId);
    }

    const tot = await pool.query(
      `SELECT
        COALESCE(SUM(CASE WHEN m.diferenca > 0 THEN m.diferenca ELSE 0 END), 0)::int AS entradas,
        COALESCE(SUM(CASE WHEN m.diferenca < 0 THEN -m.diferenca ELSE 0 END), 0)::int AS saidas
       FROM estoque_movimentos m
       WHERE ${where}`,
      paramsBase
    );

    const porProduto = await pool.query(
      `SELECT m.produto_id, p.nome,
        COALESCE(SUM(CASE WHEN m.diferenca > 0 THEN m.diferenca ELSE 0 END), 0)::int AS entradas,
        COALESCE(SUM(CASE WHEN m.diferenca < 0 THEN -m.diferenca ELSE 0 END), 0)::int AS saidas
       FROM estoque_movimentos m
       INNER JOIN estoque_produtos p ON p.id = m.produto_id
       WHERE ${where}
       GROUP BY m.produto_id, p.nome
       ORDER BY p.nome ASC`,
      paramsBase
    );

    const saidasPorDia = await pool.query(
      `SELECT m.created_at::date AS data,
        COALESCE(SUM(CASE WHEN m.diferenca < 0 THEN -m.diferenca ELSE 0 END), 0)::int AS saidas
      FROM estoque_movimentos m
      WHERE ${where}
      GROUP BY m.created_at::date
      ORDER BY m.created_at::date ASC`,
      paramsBase
    );

    const movimentacaoPorDia = await pool.query(
      `SELECT m.created_at::date AS data,
        COALESCE(SUM(CASE WHEN m.diferenca > 0 THEN m.diferenca ELSE 0 END), 0)::int AS entradas,
        COALESCE(SUM(CASE WHEN m.diferenca < 0 THEN -m.diferenca ELSE 0 END), 0)::int AS saidas
       FROM estoque_movimentos m
       WHERE ${where}
       GROUP BY m.created_at::date
       ORDER BY m.created_at::date ASC`,
      paramsBase
    );

    const saldos = await pool.query(
      `SELECT p.id AS produto_id, p.nome, p.quantidade::int AS saldo_atual
       FROM estoque_produtos p
       WHERE p.restaurante_id = $1
         ${produtoId ? 'AND p.id = $2' : ''}
       ORDER BY p.nome ASC`,
      produtoId ? [rid, produtoId] : [rid]
    );

    const rowTotais = tot.rows[0] || {};
    res.json({
      restaurante_id: rid,
      periodo: { data_inicio: dataInicio, data_fim: dataFim },
      filtro: { produto_id: produtoId || null },
      totais: {
        entradas: Number(rowTotais.entradas) || 0,
        saidas: Number(rowTotais.saidas) || 0
      },
      por_produto: Array.isArray(porProduto.rows) ? porProduto.rows : [],
      saidas_por_dia: Array.isArray(saidasPorDia.rows) ? saidasPorDia.rows : [],
      movimentacao_por_dia: Array.isArray(movimentacaoPorDia.rows) ? movimentacaoPorDia.rows : [],
      saldos: Array.isArray(saldos.rows) ? saldos.rows : []
    });
  } catch (error) {
    console.error('Erro ao resumir movimentos:', error);
    res.status(500).json({ error: 'Erro ao carregar resumo de movimentação' });
  }
});

// Lista cronológica de lançamentos (últimos N)
app.get('/api/estoque/movimentos', authenticateToken, requireModuloEstoque, async (req, res) => {
  try {
    const rid = parseInt(req.query.restaurante_id, 10);
    if (Number.isNaN(rid)) {
      return res.status(400).json({ error: 'restaurante_id é obrigatório' });
    }
    const pode = await assertEstoqueAcessoRestaurante(req, res, rid);
    if (!pode) return;

    const dataInicio = parseDateOnly(req.query.data_inicio);
    const dataFim = parseDateOnly(req.query.data_fim);
    const produtoId = req.query.produto_id ? parseInt(req.query.produto_id, 10) : null;
    if (req.query.produto_id && Number.isNaN(produtoId)) {
      return res.status(400).json({ error: 'produto_id inválido' });
    }
    const limite = Math.min(Math.max(parseInt(req.query.limite, 10) || 100, 1), 500);

    let q = `
      SELECT m.id, m.produto_id, p.nome AS produto_nome, m.quantidade_antes, m.quantidade_depois, m.diferenca,
        m.tipo, m.quantidade, m.observacao, m.estornado, m.estornado_por_movimento_id, m.movimento_estorno_de_id,
        m.created_at, u.nome AS usuario_nome
      FROM estoque_movimentos m
      INNER JOIN estoque_produtos p ON p.id = m.produto_id
      LEFT JOIN usuarios u ON u.id = m.usuario_id
      WHERE m.restaurante_id = $1`;
    const params = [rid];
    let idx = 2;
    if (dataInicio) {
      q += ` AND m.created_at::date >= $${idx}::date`;
      params.push(dataInicio);
      idx += 1;
    }
    if (dataFim) {
      q += ` AND m.created_at::date <= $${idx}::date`;
      params.push(dataFim);
      idx += 1;
    }
    if (produtoId) {
      q += ` AND m.produto_id = $${idx}`;
      params.push(produtoId);
      idx += 1;
    }
    q += ` ORDER BY m.created_at DESC LIMIT $${idx}`;
    params.push(limite);

    const result = await pool.query(q, params);
    res.json({ restaurante_id: rid, movimentos: Array.isArray(result.rows) ? result.rows : [] });
  } catch (error) {
    console.error('Erro ao listar movimentos:', error);
    res.status(500).json({ error: 'Erro ao listar movimentos' });
  }
});

// ========== Lançamentos diários simplificados (texto livre) ==========

app.get('/api/estoque/lancamentos-diarios', authenticateToken, requireModuloEstoqueSimplificado, async (req, res) => {
  try {
    const restauranteParam = req.query.restaurante_id;
    let rid = null;
    if (restauranteParam !== undefined && restauranteParam !== null && restauranteParam !== '' && restauranteParam !== 'todos') {
      rid = parseInt(restauranteParam, 10);
      if (Number.isNaN(rid)) {
        return res.status(400).json({ error: 'restaurante_id inválido' });
      }
      const pode = await assertEstoqueAcessoRestaurante(req, res, rid);
      if (!pode) return;
    }

    let dataInicio = parseDateOnly(req.query.data_inicio);
    let dataFim = parseDateOnly(req.query.data_fim);
    if (!dataInicio || !dataFim) {
      const w = periodoSemanaContendo();
      dataInicio = w.data_inicio;
      dataFim = w.data_fim;
    }
    if (dataInicio > dataFim) {
      return res.status(400).json({ error: 'data_inicio não pode ser maior que data_fim' });
    }

    const limite = Math.min(Math.max(parseInt(req.query.limite, 10) || 500, 1), 1000);
    const flags = await loadUserFlags(req.user.id);
    if (!flags) {
      return res.status(403).json({ error: 'Usuário inválido.' });
    }

    const params = [dataInicio, dataFim];
    let filtroRestaurante = '';
    if (rid) {
      params.push(rid);
      filtroRestaurante = `AND ld.restaurante_id = $${params.length}`;
    } else if (usuarioRestaurantesRestritos(flags)) {
      const restauranteIds = await restauranteIdsUsuarioEstoque(req.user.id);
      if (restauranteIds.length === 0) {
        return res.json([]);
      }
      params.push(restauranteIds);
      filtroRestaurante = `AND ld.restaurante_id = ANY($${params.length}::int[])`;
    }
    params.push(limite);

    const result = await pool.query(
      `SELECT ld.id, ld.restaurante_id, ld.usuario_id, ld.produto, ld.data_lancamento, ld.quantidade,
              ld.created_at, ld.updated_at
       FROM estoque_lancamentos_diarios ld
       WHERE (ld.data_lancamento IS NULL OR (ld.data_lancamento >= $1::date AND ld.data_lancamento <= $2::date))
         ${filtroRestaurante}
       ORDER BY ld.data_lancamento DESC NULLS LAST, ld.id DESC
       LIMIT $${params.length}`,
      params
    );
    res.json(result.rows);
  } catch (error) {
    if (error.code === '42P01') {
      return res.status(503).json({ error: 'Módulo de lançamento diário não instalado. Rode a migração 012.' });
    }
    console.error('Erro ao listar lançamentos diários:', error);
    res.status(500).json({ error: 'Erro ao listar lançamentos diários' });
  }
});

app.post('/api/estoque/lancamentos-diarios', authenticateToken, requireModuloEstoqueSimplificado, async (req, res) => {
  try {
    const { restaurante_id, produto, data_lancamento, quantidade } = req.body || {};
    const rid = parseInt(restaurante_id, 10);
    if (Number.isNaN(rid)) {
      return res.status(400).json({ error: 'restaurante_id é obrigatório' });
    }
    const pode = await assertEstoqueAcessoRestaurante(req, res, rid);
    if (!pode) return;

    const prod = produto != null ? String(produto).trim() : '';
    if (!prod) {
      return res.status(400).json({ error: 'produto é obrigatório' });
    }

    let dataVal = null;
    if (data_lancamento != null && String(data_lancamento).trim() !== '') {
      dataVal = parseDataEntradaLancamentoDiario(String(data_lancamento));
      if (!dataVal) {
        return res.status(400).json({ error: 'data_lancamento inválida. Use AAAA-MM-DD ou DD/MM/AAAA.' });
      }
    }

    const qtd = quantidade != null ? String(quantidade) : '';

    const result = await pool.query(
      `INSERT INTO estoque_lancamentos_diarios (restaurante_id, usuario_id, produto, data_lancamento, quantidade)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, restaurante_id, usuario_id, produto, data_lancamento, quantidade, created_at, updated_at`,
      [rid, req.user.id, prod, dataVal, qtd]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    if (error.code === '42P01') {
      return res.status(503).json({ error: 'Módulo de lançamento diário não instalado. Rode a migração 012.' });
    }
    console.error('Erro ao criar lançamento diário:', error);
    res.status(500).json({ error: 'Erro ao criar lançamento diário' });
  }
});

app.put('/api/estoque/lancamentos-diarios/:id', authenticateToken, requireModuloEstoqueSimplificado, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      return res.status(400).json({ error: 'id inválido' });
    }

    const existing = await pool.query('SELECT * FROM estoque_lancamentos_diarios WHERE id = $1', [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Lançamento não encontrado' });
    }

    const row = existing.rows[0];
    const pode = await assertEstoqueAcessoRestaurante(req, res, row.restaurante_id);
    if (!pode) return;

    const body = req.body || {};
    let rid = row.restaurante_id;
    if (body.restaurante_id !== undefined) {
      rid = parseInt(body.restaurante_id, 10);
      if (Number.isNaN(rid)) {
        return res.status(400).json({ error: 'restaurante_id inválido' });
      }
      if (rid !== row.restaurante_id) {
        const podeDestino = await assertEstoqueAcessoRestaurante(req, res, rid);
        if (!podeDestino) return;
      }
    }

    const prod =
      body.produto !== undefined && String(body.produto).trim() !== ''
        ? String(body.produto).trim()
        : row.produto;
    if (!prod) {
      return res.status(400).json({ error: 'produto é obrigatório' });
    }

    let dataVal = row.data_lancamento;
    if (body.data_lancamento !== undefined) {
      if (body.data_lancamento === null || String(body.data_lancamento).trim() === '') {
        dataVal = null;
      } else {
        dataVal = parseDataEntradaLancamentoDiario(String(body.data_lancamento));
        if (!dataVal) {
          return res.status(400).json({ error: 'data_lancamento inválida. Use AAAA-MM-DD ou DD/MM/AAAA.' });
        }
      }
    }

    const qtd = body.quantidade !== undefined ? String(body.quantidade) : row.quantidade;

    const result = await pool.query(
      `UPDATE estoque_lancamentos_diarios
       SET restaurante_id = $1, produto = $2, data_lancamento = $3, quantidade = $4, updated_at = CURRENT_TIMESTAMP
       WHERE id = $5
       RETURNING id, restaurante_id, usuario_id, produto, data_lancamento, quantidade, created_at, updated_at`,
      [rid, prod, dataVal, qtd, id]
    );
    res.json(result.rows[0]);
  } catch (error) {
    if (error.code === '42P01') {
      return res.status(503).json({ error: 'Módulo de lançamento diário não instalado. Rode a migração 012.' });
    }
    console.error('Erro ao atualizar lançamento diário:', error);
    res.status(500).json({ error: 'Erro ao atualizar lançamento diário' });
  }
});

app.delete('/api/estoque/lancamentos-diarios/:id', authenticateToken, requireModuloEstoqueSimplificado, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      return res.status(400).json({ error: 'id inválido' });
    }

    const existing = await pool.query('SELECT * FROM estoque_lancamentos_diarios WHERE id = $1', [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Lançamento não encontrado' });
    }

    const pode = await assertEstoqueAcessoRestaurante(req, res, existing.rows[0].restaurante_id);
    if (!pode) return;

    await pool.query('DELETE FROM estoque_lancamentos_diarios WHERE id = $1', [id]);
    res.json({ message: 'Lançamento removido', id });
  } catch (error) {
    if (error.code === '42P01') {
      return res.status(503).json({ error: 'Módulo de lançamento diário não instalado. Rode a migração 012.' });
    }
    console.error('Erro ao remover lançamento diário:', error);
    res.status(500).json({ error: 'Erro ao remover lançamento diário' });
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
    const existing = await pool.query('SELECT restaurante_id FROM boletos_notas WHERE id = $1', [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Lançamento não encontrado' });
    }
    const pode = await assertBoletosAcessoRestaurante(req, res, existing.rows[0].restaurante_id);
    if (!pode) return;
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

async function listarRestauranteIdsUsuario(userId) {
  const assoc = await pool.query(
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
  return listarRestauranteIdsUsuario(userId);
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

    const restrito = !moduloFinanceiro && (moduloEstoque || moduloEstoqueSimplificado || moduloBoletos);
    const restauranteIds = Array.isArray(body.restaurante_ids)
      ? body.restaurante_ids.map((x) => parseInt(x, 10)).filter((x) => !Number.isNaN(x))
      : [];
    if (restrito && restauranteIds.length === 0) {
      return res.status(400).json({
        error: 'Usuário sem módulo financeiro precisa de ao menos um restaurante liberado.'
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

    const restrito = !moduloFinanceiro && (moduloEstoque || moduloEstoqueSimplificado || moduloBoletos);
    let restauranteIds = [];
    if (restrito) {
      restauranteIds = Array.isArray(body.restaurante_ids)
        ? body.restaurante_ids.map((x) => parseInt(x, 10)).filter((x) => !Number.isNaN(x))
        : await listarRestauranteIdsUsuario(userId);
      if (restauranteIds.length === 0) {
        return res.status(400).json({
          error: 'Usuário sem módulo financeiro precisa de ao menos um restaurante liberado.'
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

// ========== Admin: usuários de estoque + vínculos com restaurantes (legado) ==========

app.get('/api/admin/usuarios-estoque', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT u.id, u.username, u.nome, u.created_at,
        COALESCE(
          array_agg(ur.restaurante_id ORDER BY ur.restaurante_id) FILTER (WHERE ur.restaurante_id IS NOT NULL),
          ARRAY[]::integer[]
        ) AS restaurante_ids
       FROM usuarios u
       LEFT JOIN usuario_restaurante_estoque ur ON ur.usuario_id = u.id
       WHERE COALESCE(u.somente_estoque, false) = true
       GROUP BY u.id, u.username, u.nome, u.created_at
       ORDER BY u.nome ASC`
    );
    const rows = result.rows.map((row) => ({
      id: row.id,
      username: row.username,
      nome: row.nome,
      created_at: row.created_at,
      restaurante_ids: Array.isArray(row.restaurante_ids) ? row.restaurante_ids : []
    }));
    res.json(rows);
  } catch (error) {
    console.error('Erro ao listar usuários de estoque:', error);
    res.status(500).json({ error: 'Erro ao listar usuários de estoque' });
  }
});

app.post('/api/admin/usuarios-estoque', authenticateToken, requireAdmin, async (req, res) => {
  const client = await pool.connect();
  try {
    const { username, password, nome, restaurante_ids } = req.body || {};
    if (!username || String(username).trim() === '') {
      return res.status(400).json({ error: 'username é obrigatório' });
    }
    if (!password || String(password).length < 4) {
      return res.status(400).json({ error: 'Senha é obrigatória (mín. 4 caracteres).' });
    }
    if (!nome || String(nome).trim() === '') {
      return res.status(400).json({ error: 'nome é obrigatório' });
    }
    let ids = Array.isArray(restaurante_ids) ? restaurante_ids.map((x) => parseInt(x, 10)).filter((x) => !Number.isNaN(x)) : [];
    if (ids.length === 0) {
      return res.status(400).json({ error: 'Associe ao menos um restaurante.' });
    }
    const dup = await client.query('SELECT id FROM usuarios WHERE username = $1', [String(username).trim()]);
    if (dup.rows.length > 0) {
      return res.status(409).json({ error: 'Já existe usuário com este login.' });
    }
    const hash = await bcrypt.hash(String(password), 10);
    await client.query('BEGIN');
    const ins = await client.query(
      `INSERT INTO usuarios (username, password, nome, is_admin, somente_estoque)
       VALUES ($1, $2, $3, false, true)
       RETURNING id, username, nome, created_at`,
      [String(username).trim(), hash, String(nome).trim()]
    );
    const newUser = ins.rows[0];
    let inseridos = 0;
    for (const rid of ids) {
      const ex = await client.query('SELECT id FROM restaurantes WHERE id = $1 AND ativo = true', [rid]);
      if (ex.rows.length === 0) continue;
      await client.query(
        `INSERT INTO usuario_restaurante_estoque (usuario_id, restaurante_id) VALUES ($1, $2)
         ON CONFLICT (usuario_id, restaurante_id) DO NOTHING`,
        [newUser.id, rid]
      );
      inseridos += 1;
    }
    if (inseridos === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Nenhum dos restaurantes informados é válido ou está ativo.' });
    }
    await client.query('COMMIT');
    const restauranteIds = await restauranteIdsUsuarioEstoque(newUser.id);
    res.status(201).json({
      id: newUser.id,
      username: newUser.username,
      nome: newUser.nome,
      created_at: newUser.created_at,
      restaurante_ids: restauranteIds
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (error.code === '23505') {
      return res.status(409).json({ error: 'Já existe usuário com este login.' });
    }
    console.error('Erro ao criar usuário de estoque:', error);
    res.status(500).json({ error: 'Erro ao criar usuário de estoque' });
  } finally {
    client.release();
  }
});

app.put('/api/admin/usuarios-estoque/:id', authenticateToken, requireAdmin, async (req, res) => {
  const client = await pool.connect();
  try {
    const userId = parseInt(req.params.id, 10);
    if (Number.isNaN(userId)) {
      return res.status(400).json({ error: 'id inválido' });
    }
    if (userId === req.user.id) {
      return res.status(400).json({ error: 'Não é possível alterar o próprio usuário por esta tela.' });
    }
    const cur = await client.query(
      'SELECT id, username, nome FROM usuarios WHERE id = $1 AND COALESCE(somente_estoque, false) = true',
      [userId]
    );
    if (cur.rows.length === 0) {
      return res.status(404).json({ error: 'Usuário de estoque não encontrado.' });
    }
    const { nome, password, restaurante_ids } = req.body || {};
    await client.query('BEGIN');
    if (nome !== undefined) {
      if (String(nome).trim() === '') {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'nome não pode ser vazio.' });
      }
      await client.query('UPDATE usuarios SET nome = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [
        String(nome).trim(),
        userId
      ]);
    }
    if (password !== undefined && String(password) !== '') {
      if (String(password).length < 4) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Senha deve ter no mínimo 4 caracteres.' });
      }
      const hash = await bcrypt.hash(String(password), 10);
      await client.query('UPDATE usuarios SET password = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [
        hash,
        userId
      ]);
    }
    if (restaurante_ids !== undefined) {
      const ids = Array.isArray(restaurante_ids)
        ? restaurante_ids.map((x) => parseInt(x, 10)).filter((x) => !Number.isNaN(x))
        : [];
      await client.query('DELETE FROM usuario_restaurante_estoque WHERE usuario_id = $1', [userId]);
      for (const rid of ids) {
        const ex = await client.query('SELECT id FROM restaurantes WHERE id = $1 AND ativo = true', [rid]);
        if (ex.rows.length === 0) continue;
        await client.query(
          `INSERT INTO usuario_restaurante_estoque (usuario_id, restaurante_id) VALUES ($1, $2)
           ON CONFLICT (usuario_id, restaurante_id) DO NOTHING`,
          [userId, rid]
        );
      }
    }
    await client.query('COMMIT');
    const row = await pool.query(
      'SELECT id, username, nome, created_at FROM usuarios WHERE id = $1',
      [userId]
    );
    const restauranteIds = await restauranteIdsUsuarioEstoque(userId);
    res.json({
      ...row.rows[0],
      restaurante_ids: restauranteIds
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Erro ao atualizar usuário de estoque:', error);
    res.status(500).json({ error: 'Erro ao atualizar usuário de estoque' });
  } finally {
    client.release();
  }
});

app.delete('/api/admin/usuarios-estoque/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const userId = parseInt(req.params.id, 10);
    if (Number.isNaN(userId)) {
      return res.status(400).json({ error: 'id inválido' });
    }
    if (userId === req.user.id) {
      return res.status(400).json({ error: 'Não é possível excluir o próprio usuário.' });
    }
    const cur = await pool.query(
      'SELECT id FROM usuarios WHERE id = $1 AND COALESCE(somente_estoque, false) = true',
      [userId]
    );
    if (cur.rows.length === 0) {
      return res.status(404).json({ error: 'Usuário de estoque não encontrado.' });
    }
    await pool.query('DELETE FROM usuarios WHERE id = $1', [userId]);
    res.json({ message: 'Usuário removido', id: userId });
  } catch (error) {
    console.error('Erro ao remover usuário de estoque:', error);
    res.status(500).json({ error: 'Erro ao remover usuário de estoque' });
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
