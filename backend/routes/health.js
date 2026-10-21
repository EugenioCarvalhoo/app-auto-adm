const express = require('express');
const pool = require('../db');

const router = express.Router();

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

router.get('/api/health', apiHealthLiveness);
router.get('/api/health/ready', healthWithDatabase);
// Easypanel / probes antigos: mantém checagem com banco na raiz
router.get('/health', healthWithDatabase);

module.exports = router;
