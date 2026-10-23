// Carregar .env do diretório backend ANTES de importar os módulos que leem process.env (db.ts)
import './lib/loadEnv';
import express from 'express';
import cors from 'cors';
import pool from './db';
import authRouter from './routes/auth';
import restaurantesRouter from './routes/restaurantes';
import boletosRouter from './routes/boletos';
import boletosImagemRouter from './routes/boletosImagem';
import adminRouter from './routes/admin';
import healthRouter from './routes/health';
import { migracoesPendentes } from './lib/migracoes';
import { mensagemErro } from './lib/erros';

const app = express();
const PORT = Number(process.env.PORT) || 5000;

// Aumentar limite de headers para evitar erro 431
app.use((req, res, next) => {
  req.headers['content-length'] = req.headers['content-length'] || '0';
  next();
});

// Middleware
app.use(cors({
  credentials: true,
  exposedHeaders: ['Retry-After', 'Content-Disposition'],
  maxAge: 86400
}));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

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
app.use(authRouter);
app.use(restaurantesRouter);
app.use(boletosImagemRouter);
app.use(boletosRouter);
app.use(adminRouter);
app.use(healthRouter);

// Expõe o pool para os testes de integração encerrarem as conexões.
app.locals.pool = pool;

export = app;

// Só escuta porta quando o arquivo é executado diretamente (npm start / node server.js)
if (require.main === module) {
  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`Servidor rodando na porta ${PORT}`);
    console.log('[boot] GET /api/health (liveness) | GET /api/health/ready (Postgres) | POST /api/login');
    if (process.env.LOG_HTTP !== '0' && process.env.LOG_HTTP !== 'false') {
      console.log('[boot] Log de cada requisição HTTP ativo — defina LOG_HTTP=0 para desligar');
    }
  });

  // Avisa (sem encerrar nem migrar) se o banco está desatualizado.
  if (process.env.NODE_ENV !== 'test') {
    pool
      .query('SELECT 1')
      .then(() => migracoesPendentes(pool))
      .then((pendentes) => {
        if (pendentes.length > 0) {
          console.error('==================================================================');
          console.error(`[boot] ATENCAO: ${pendentes.length} migration(s) pendente(s) no banco:`);
          pendentes.forEach((m) => console.error(`[boot]   - ${m}`));
          console.error('[boot] Rode: node database/migrate.js (faça pg_dump antes)');
          console.error('==================================================================');
        } else {
          console.log('[boot] Migrations em dia.');
        }
      })
      .catch((error) => {
        console.error('[boot] Não foi possível verificar migrations:', mensagemErro(error));
      });
  }

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

