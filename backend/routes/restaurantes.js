const express = require('express');
const pool = require('../db');
const { authenticateToken } = require('../middleware/auth');
const {
  requireAdmin,
  loadUserFlags,
  usuarioRestaurantesRestritos,
  usuarioPodeRestaurante
} = require('../middleware/permissoes');

const router = express.Router();

// Protected Routes
// Restaurantes Routes
// Get all restaurants
router.get('/api/restaurantes', authenticateToken, async (req, res) => {
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
router.get('/api/restaurantes/:id', authenticateToken, async (req, res) => {
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
router.post('/api/restaurantes', authenticateToken, requireAdmin, async (req, res) => {
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
router.put('/api/restaurantes/:id', authenticateToken, requireAdmin, async (req, res) => {
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
router.delete('/api/restaurantes/:id', authenticateToken, requireAdmin, async (req, res) => {
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

module.exports = router;
