/**
 * COMPATIBILIDADE (NÃO vai para produção: fora do `include` do tsconfig, logo não é compilado para dist/).
 *
 *  - `require('./server')` devolve um app Express "fino" com `app.locals.pool`, que repassa as requisições
 *    ao app NestJS (src/app.ts). Mantém a suíte de testes antiga funcionando sem alterações.
 *  - Executado direto (`npx tsx server.ts`, como o E2E fazia), delega ao bootstrap real (src/main.ts).
 *
 * Produção usa `dist/main.js` (src/main.ts). Os testes novos devem usar `criarApp()` de src/app.ts.
 */
import './src/config/loadEnv';
import express from 'express';
import { criarApp } from './src/app';
import { criarPool } from './src/shared/infrastructure/database/pool';

const app = express();

if (require.main === module) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('./src/main');
} else {
  const pool = criarPool();
  app.locals.pool = pool;

  const nest = criarApp({ pool });
  nest.catch((error) => console.error('Falha ao iniciar o app Nest:', error));
  app.locals.nest = nest;

  app.use((req, res, next) => {
    nest.then(
      (n) => (n.getHttpAdapter().getInstance() as express.Express)(req, res, next),
      next
    );
  });
}

export = app;
