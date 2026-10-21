const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');

// Carregar .env do diretório backend ANTES de importar os módulos que leem process.env
dotenv.config({ path: path.join(__dirname, '.env') });

const pool = require('./db');

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

// Cada router declara o caminho completo (/api/...), então todos montam na raiz.
app.use(require('./routes/auth'));
app.use(require('./routes/restaurantes'));
app.use(require('./routes/boletos'));
app.use(require('./routes/admin'));
app.use(require('./routes/health'));

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

