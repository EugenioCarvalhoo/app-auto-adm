const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../db');
const { authenticateToken, JWT_SECRET } = require('../middleware/auth');
const { shapeUserForClient } = require('../middleware/permissoes');

const router = express.Router();

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
        modulo_boletos: shaped.modulo_boletos
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

router.post('/api/login', loginHandler);
router.post('/login', loginHandler);

// Verify token
router.get('/api/verify', authenticateToken, async (req, res) => {
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

module.exports = router;
