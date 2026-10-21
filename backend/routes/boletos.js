const express = require('express');
const pool = require('../db');
const { authenticateToken } = require('../middleware/auth');
const { requireModuloBoletos, loadUserFlags, assertBoletosAcessoRestaurante } = require('../middleware/permissoes');
const { intervaloSemana, normalizarTipo } = require('../lib/boletosSemana');
const {
  hojeBrasil,
  dateToIso,
  parseValorBoleto,
  erroTabelaBoletos,
  enriquecerBoleto,
  enriquecerMeta,
  parseDateOnly,
  BOLETO_SELECT,
  META_SELECT
} = require('../lib/boletos');

const router = express.Router();

// ========== Boletos e notas ==========

router.get('/api/boletos/resumo', authenticateToken, requireModuloBoletos, async (req, res) => {
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

router.get('/api/boletos', authenticateToken, requireModuloBoletos, async (req, res) => {
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

router.post('/api/boletos', authenticateToken, requireModuloBoletos, async (req, res) => {
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

router.put('/api/boletos/:id', authenticateToken, requireModuloBoletos, async (req, res) => {
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

router.delete('/api/boletos/:id', authenticateToken, requireModuloBoletos, async (req, res) => {
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

router.get('/api/boletos/metas', authenticateToken, requireModuloBoletos, async (req, res) => {
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

router.post('/api/boletos/metas', authenticateToken, requireModuloBoletos, async (req, res) => {
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

router.put('/api/boletos/metas/:id', authenticateToken, requireModuloBoletos, async (req, res) => {
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

router.delete('/api/boletos/metas/:id', authenticateToken, requireModuloBoletos, async (req, res) => {
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

module.exports = router;
