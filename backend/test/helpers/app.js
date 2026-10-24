/**
 * Bootstrap do app sob teste (NestJS). É o ÚNICO lugar dos testes que sabe como subir a API.
 *
 * Devolve `app` (servidor HTTP aceito por `request(app)`), `nest` (aplicação Nest), `pool` (o MESMO
 * pool `pg` que a API usa: os testes espionam `pool.query`/`pool.connect`) e `fechar`.
 *
 * Pré-requisito: NODE_ENV=test, JWT_SECRET e DB_* já definidos pelo chamador ANTES de `criarApp()`.
 * Os requires ficam dentro da função para respeitar `jest.mock('pg')` e `jest.isolateModulesAsync`.
 *
 * @returns {Promise<{ app: import('http').Server, nest: any, pool: import('pg').Pool, fechar: () => Promise<void> }>}
 */
async function criarApp() {
  // eslint-disable-next-line global-require
  const { criarApp: criarAppNest, obterPool } = require('../../src/app');
  const nest = await criarAppNest();
  const pool = obterPool(nest);
  return {
    app: nest.getHttpServer(),
    nest,
    pool,
    fechar: async () => {
      await nest.close();
      await pool.end();
    }
  };
}

module.exports = { criarApp };
