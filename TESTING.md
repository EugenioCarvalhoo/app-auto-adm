# Testes automatizados

Três camadas: **Jest + Supertest** no backend (Postgres real), **Jest + Testing Library** no frontend (Create React App) e **Playwright** (E2E). O CI roda todas e também constrói as imagens Docker.

## Backend (`backend/`)

- **Unitários:** funções puras em `lib/` (ex.: `test/boletosSemana.test.js`, `test/erros.test.js`).
- **Integração:** **Supertest** contra o `app` Express exportado por `server.ts`, com **Postgres real** em banco `*_test`. Detalhes em `backend/test/README.md`. Só `test/health.test.js` ainda mocka o `pg`.
- **Upgrade e migrations pendentes:** `test/upgrade.test.js` monta o estado da migration 015 com dados em um banco isolado (`controle_financeiro_upgrade_test`), aplica 016+017 com o `migrate.js` e confere vínculos, índices, boletos/metas e idempotência; `test/healthMigrations.test.js` cobre `/api/health/ready`. O upgrade cria e apaga bancos `*_upgrade_test`.
- **Não rode duas execuções de `npm test` ao mesmo tempo** no mesmo banco (causa deadlocks). No Windows, o container `pg-controle` pode ser derrubado pelo WSL ocioso: `wsl -d Ubuntu -- docker start pg-controle`.
- O servidor só chama `listen()` quando o arquivo é executado diretamente (`node dist/server.js`), permitindo `require('../server')` nos testes sem abrir porta.
- Com `NODE_ENV=test`, o backend não faz ping inicial ao PostgreSQL nem imprime logs de configuração do banco.
- O `npm test` sobe o Postgres de teste (Docker) sozinho.

```bash
cd backend
npm install
npm test              # uma execução; sobe o Postgres de teste no Docker se precisar
npm run test:watch    # durante o desenvolvimento
npm run test:coverage # cobertura (pastas configuradas no jest.config.js)
npm run typecheck     # tsc --noEmit
npm run build         # tsc -> dist/
```

## Frontend (`frontend/`)

- Testes com **`react-scripts test`** (Jest + `@testing-library/react`).
- Arquivos: `*.test.js` ou `*.test.tsx` junto ao código; `setupTests.js` importa `@testing-library/jest-dom`.

```bash
cd frontend
npm test              # CI=true npm test para execução não interativa
npx tsc --noEmit
```

## E2E (`e2e/`)
Playwright com Chromium contra API e front reais e Postgres real. Veja `e2e/README.md`.

```bash
cd e2e && npm test
```

## Imagens Docker
O job `docker` do CI roda `docker build ./backend` e `docker build ./frontend`. Para validar a stack inteira localmente (migrations, health, front): `docker compose up --build` (ver `docs/DEPLOY-DOCKER.md`).

## Referências

- [Jest](https://jestjs.io/)
- [Supertest](https://github.com/ladjs/supertest)
- [Testing Library](https://testing-library.com/docs/react-testing-library/intro/)
- [Playwright](https://playwright.dev/)
