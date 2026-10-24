// Ponto de entrada da API (npm start / node dist/main.js / tsx src/main.ts).
import { criarApp, obterPool } from './app';
import { mensagemErro } from './shared/domain/erros';
import { migracoesPendentes } from './health/infrastructure/pg-saude';

async function bootstrap(): Promise<void> {
  const PORT = Number(process.env.PORT) || 5000;
  const app = await criarApp();
  const pool = obterPool(app);

  await app.listen(PORT, '0.0.0.0');
  console.log(`Servidor rodando na porta ${PORT}`);
  console.log('[boot] GET /api/health (liveness) | GET /api/health/ready (Postgres) | POST /api/login');
  if (process.env.LOG_HTTP !== '0' && process.env.LOG_HTTP !== 'false') {
    console.log('[boot] Log de cada requisição HTTP ativo — defina LOG_HTTP=0 para desligar');
  }

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

  const encerrar = (sinal: string) => {
    console.log(`${sinal} recebido, encerrando servidor graciosamente...`);
    app.getHttpServer().close(() => {
      console.log('Servidor encerrado');
      pool.end(() => {
        console.log('Pool de conexões fechado');
        process.exit(0);
      });
    });
  };
  process.on('SIGTERM', () => encerrar('SIGTERM'));
  process.on('SIGINT', () => encerrar('SIGINT'));

  process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  });

  process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    process.exit(1);
  });
}

bootstrap().catch((error) => {
  console.error('Falha ao iniciar a API:', error);
  process.exit(1);
});
