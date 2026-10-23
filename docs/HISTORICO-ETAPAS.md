# Histórico das etapas (handoff entre ambientes)

Registro do que foi decidido e feito até 21/10/2026, para retomar o trabalho em outro ambiente (ex.: WSL) sem perder contexto. Complementa `CLAUDE.md` (regras do projeto) e `docs/PLANO-DE-ACAO.md` (plano de limpeza).

## 1. Objetivo
Reduzir o projeto ao que importa hoje:
1. Cadastro de boletos/notas e seu dashboard (front e back).
2. Autenticação e autorização de usuários, com separação por restaurante.

Todo o resto (gastos, relatórios, estoque) é legado a remover **depois** de a regra de acesso estar validada.

## 2. Decisões do dono do projeto
- **Dados de gastos e estoque em produção podem ser apagados** (sem exportar antes).
- **Dashboard admin continua como está**, mas só com o que sobrar (boletos, restaurantes, permissões).
- **Regra de acesso:**
  - Admin: acesso total e CRUD de tudo, em todos os restaurantes.
  - Demais usuários: só o que o admin liberar — o módulo de boletos **e** cada restaurante vinculado. Sem vínculo, não veem nada. Não gerenciam restaurantes nem usuários.
  - Um usuário pode ter vários restaurantes; ao entrar, escolhe qual usar.
  - O antigo `modulo_financeiro` deixa de dar acesso livre a todos os restaurantes.
- **Ordem combinada:** primeiro aplicar a regra de negócio **sem remover nada**, depois testes unitários; só então a limpeza dos módulos legados.

## 3. O que foi feito

### Análise e documentação
- `CLAUDE.md` na raiz (stack, comandos, escopo ativo, regra de acesso, regras para o Claude).
- `docs/PLANO-DE-ACAO.md`: diagnóstico do que manter/descartar e fases 0 a 7.

### Regra de acesso (backend — originalmente em `server.js`, hoje `middleware/permissoes.ts`)
- `usuarioRestaurantesRestritos(flags)` agora é `!flags.is_admin` (todo não-admin é restrito aos vínculos).
- `assertBoletosAcessoRestaurante` e `assertEstoqueAcessoRestaurante`: só `is_admin` ignora o vínculo; antes `modulo_financeiro` também ignorava.
- `POST/PUT/DELETE /api/restaurantes` passaram de `requireFinanceiroAccess` para `requireAdmin`.
- `POST/PUT /api/admin/usuarios-permissoes`: todo não-admin exige ao menos um restaurante liberado (`restrito = true`).
- **Bug corrigido:** `parseDateOnly` aceitava datas impossíveis (ex.: `2026-02-31`), que o Postgres rejeitava com erro 500. Agora devolve 400.

### Frontend
- `frontend/src/lib/userPermissoes.js`: `usuarioRestaurantesRestritos(user)` = `!!user && !user.is_admin`.
- `frontend/src/components/AdminPermissoesUsuarios.tsx`: restaurante obrigatório para todo não-admin; textos ajustados.
- `frontend/src/App.js`: aba e tela "Restaurantes" só para admin.

### Banco e migrations
- `backend/database/migrations/015_vinculo_restaurantes_regra_admin.sql`: vincula quem tinha `modulo_financeiro` (não-admin) a todos os restaurantes ativos, para ninguém perder acesso. O admin ajusta depois.
- `backend/database/migrate.js`: incluída a `015` e criada a tabela `schema_migrations`, que registra as migrations aplicadas e pula as já rodadas. Motivo: antes o script reexecutava tudo a cada chamada, e a `015` recriaria vínculos que o admin removeu.

### Testes (todos passando)
- **Backend:** `cd backend && npx jest`. Inicialmente 111 testes com um banco falso em memória; depois migrados para Postgres real (ver a seção abaixo). Arquivos: `auth`, `restaurantes`, `boletos`, `permissoes`, `migrations`.
- **Frontend: 11 testes** (`cd frontend && CI=true npx react-scripts test --watchAll=false`). Novo: `src/lib/userPermissoes.test.js`.
- `npx tsc --noEmit` no frontend: sem erros.
- Prova de eficácia: reintroduzir o furo antigo faz 7 testes falharem; com a regra correta, todos passam.

### Testes migrados para Postgres real (21/10/2026)
- O banco falso (`fakeDb.js`) foi **removido**. Os testes agora rodam contra um Postgres 15 real em Docker dentro do WSL2: container `pg-controle`, porta `127.0.0.1:5433`, bancos `controle_financeiro_dev` e `controle_financeiro_test`, volume `pg_controle_data`. (O container não interfere nos outros containers do usuário; o `tryton_db` usa a 5432.)
- `test/globalSetup.js` recria o schema e roda o `migrate.js` a cada execução. `test/helpers/dbConfig.js` **recusa** qualquer banco que não termine em `_test`. Documentação: `backend/test/README.md`.
- Resultado: **124 testes** no back (8 suítes), todos passando. Nova suíte `migrations.test.js` testa a `015` com dados reais (vincula só quem tinha `modulo_financeiro`, só restaurantes ativos, idempotente) e que o `migrate.js` pula o já aplicado.
- Reintroduzir o furo antigo faz 4 testes falharem; o código correto passa em tudo.
- **Bug achado só com banco real:** valor acima do limite do `NUMERIC(14,2)` (ex.: `99999999999999999`) causava erro 500. Agora `parseValorBoleto` rejeita acima de 999.999.999.999,99 com 400 (vale também para metas).
- Observação: o `localhost` do Windows resolve para IPv6 e é recusado pelo repasse do WSL2; use `127.0.0.1`.
- Para retomar em outro ambiente: basta `cd backend && npm test`. O `scripts/test.js` inicia/cria o container `pg-controle` sozinho (no Windows via `wsl -d Ubuntu`; em Linux/WSL via `docker` direto), cria o banco `*_test` e roda o Jest. `npm run test:jest` roda o Jest puro (usado no CI).

### Pipeline de CI/deploy (21/10/2026)
- Criado `.github/workflows/ci-deploy.yml` (GitHub Actions): `backend` (Jest com Postgres 15 de serviço), `frontend` (testes, `tsc`, build), `docker` (build das duas imagens) e, só se tudo passar, deploy por webhook do Easypanel: branch `homologacao` -> hml; branch `main` -> produção (ambiente `producao` com aprovação manual).
- Validado só localmente (YAML, Jest, build, `npm ci --dry-run`); **ainda não rodou no GitHub**.
- O build do front no CI usa `CI=true` (lint rigoroso) desde a Fase 2.
- Pendente do usuário: criar branch `homologacao`; criar secrets `EASYPANEL_HML_API_WEBHOOK`, `EASYPANEL_HML_WEB_WEBHOOK`, `EASYPANEL_PROD_API_WEBHOOK`, `EASYPANEL_PROD_WEB_WEBHOOK`; criar ambientes `homologacao` e `producao` (reviewers na produção); desligar o deploy automático por push no Easypanel. A migration continua manual (`npm run migrate` no terminal do back) ou via Comando de Início `node database/migrate.js && node dist/server.js`.

### Testes E2E com Playwright (21/10/2026)
- Pasta `e2e/` (projeto próprio): 39 testes em 6 suítes (login/sessão, acesso por perfil, boletos, metas, administração, isolamento direto na API). Detalhes em `e2e/README.md`.
- Sobe API (`:5100`) e front (`:3100`) contra o banco `controle_financeiro_e2e_test` no mesmo container `pg-controle`; semeia o cenário do Jest antes de cada teste. Job `e2e` adicionado ao CI e exigido pelos deploys.
- **Bug achado e corrigido:** o interceptor global do axios tratava o 401 do próprio login como sessão expirada e recarregava a página, apagando a mensagem de erro. Agora ignora a URL `/login`.
- Observação: a tela de Usuários (`AdminPermissoesUsuarios.tsx`) ainda mostra as flags legadas (Financeiro, Estoque, Estoque simplificado); sai na limpeza das fases 3 e 4.

### Fase 3 — back legado removido (21/10/2026)
- Removidos: `/api/gastos*`, `/api/estoque*`, `/api/admin/usuarios-estoque*`, helpers de estoque, `requireFinanceiroAccess`/`requireModuloEstoque*`, `lib/estoqueQuantidade.js` e seu teste. `server.js` foi de 2.882 para 97 linhas.
- Dividido em `db.js`, `middleware/permissoes.js`, `lib/boletos.js` e `routes/{auth,restaurantes,boletos,admin,health}.js` (cada router mantém o caminho completo `/api/...` e monta na raiz). Comportamento idêntico: 117 testes Jest e 39 E2E passando.
- Ainda no back, de propósito (Fase 4): flags legadas `modulo_financeiro`, `modulo_estoque*`, `somente_estoque` em `loadUserFlags`, no login e nas rotas de permissões; tabela `usuario_restaurante_estoque`. Saem junto com a migration `016`.

### Fase 4 parcial — rename do vínculo (21/10/2026)
- Migration `016_renomeia_vinculo_usuario_restaurantes.sql`: só renomeia a tabela e seus índices (idempotente, sem perda de dados). Nenhum `DROP`.
- Antes de publicar: rodar `npm run migrate` em homologação **junto** com o deploy do código novo (o código antigo não encontra o nome novo, e vice-versa).
- Pendente (precisa de confirmação do dono): `DROP TABLE gastos` e `estoque_*`; `DROP COLUMN` de `modulo_financeiro`, `modulo_estoque`, `modulo_estoque_simplificado`, `somente_estoque`; e remover as flags legadas do código e da tela de Usuários.

### Fase 4 — DROP do legado (21/10/2026, autorizado pelo dono)
- Migration `017_remove_legado_gastos_estoque.sql`: `DROP` de `estoque_movimentos`, `estoque_lancamentos_diarios`, `estoque_produtos`, `estoque_categorias`, da função do trigger de estoque e de `gastos`; `DROP COLUMN` de `modulo_financeiro`, `modulo_estoque`, `modulo_estoque_simplificado` e `somente_estoque` em `usuarios`. Sem `CASCADE`. **Faça `pg_dump` antes de aplicar em homologação/produção.**
- Código sem as flags legadas: `loadUserFlags` virou uma consulta só; login/verify devolvem `{ id, username, nome, is_admin, modulo_boletos, restaurante_ids }`; a tela de Usuários mostra apenas "Boletos e notas".
- Mudança de contrato: `PUT /api/admin/usuarios-permissoes/:id` agora exige `modulo_boletos` booleano e aceita `false` (revoga o acesso); antes, o corpo sem módulos marcados dava 400. `POST` continua exigindo boletos marcado.
- Quem só tinha estoque fica sem módulo após a 017 (não vê nada) até o admin liberar boletos; quem tinha `modulo_financeiro` já tinha ganhado boletos (014) e vínculos (015).
- Testes: 119 Jest (a 015 roda recriando a coluna `modulo_financeiro` só dentro do próprio bloco de teste), 11 front, 39 E2E. Build do front com `CI=true` ok.
- Sobras fora do código (Fase 6): `MODULO_ESTOQUE.md`, `Manual_modulo_estoque_cliente.html`, `backend/database/exemplo_usuario_estoque.sql` e `init.sql` ainda falam de estoque/gastos.

### Homologação (banco `financialmanagementbdhomolog`)
- Migration executada: `001` a `015` aplicadas; segunda execução pulou todas.
- Antes: 1 usuário (admin), 2 restaurantes, 6 boletos. A `015` não alterou vínculos (só havia o admin).
- Teste manual do dono: usuário `Test` (não-admin, só boletos, vinculado a 2 restaurantes) viu os dois na escolha inicial e cadastrou boleto em cada um. Confirmado no banco: boletos `id` 10 (restaurante 1) e 11 (restaurante 2), ambos com autor `Test`.
- Esses dois boletos de teste e o usuário `Test` continuam em homologação.

## 4. Estado atual e pendências
- **Commits feitos na branch `feat/regra-acesso-admin`** (6 commits: regra de acesso, migration 015, correções de validação, testes, CI e docs), ainda **sem push** e sem merge na `main`. Ficaram de fora, de propósito: a alteração do usuário em `frontend/package.json` (script `start` sem `cross-env`) e a pasta `.vscode/` vazia.
- `frontend/package.json` tem alteração sua não commitada: o script `start` perdeu o `cross-env HOST=0.0.0.0`. No WSL/Linux, `start:unix` ou `HOST=0.0.0.0 react-scripts start` resolve; decida qual manter.
- **Deploy do código novo em homologação ainda não confirmado.** A migration já está no banco; a regra só vale com o back e o front novos publicados. (O teste manual com o `Test` funcionou; confirme que foi com o código novo.)
- O `Dockerfile` do back só roda `node dist/server.js`: a migration não roda sozinha no deploy. Executar `npm run migrate` manualmente nos ambientes (produção ainda não foi migrada).
- Não testado em homologação: o lado negativo (usuário não ver restaurante não liberado). Está coberto só pelos testes automatizados.
- Não executei `npm run build` do frontend.

## 5. Próximos passos (ordem sugerida)
1. Commit em branch (ex.: `regra-acesso-admin`) com a regra, a `015`, o `migrate.js`, os testes e os docs.
2. ~~Fase 2~~ **feita (21/10/2026)**: remover o front legado (`GridEditavel`, `Relatorios`, `components/estoque/`, `Estoque.css`, `AdminUsuariosEstoque`), simplificar `App.js`, `AdminDashboard.tsx` e `userPermissoes.js`.
3. ~~Fase 3~~ **feita (21/10/2026)**: remover do `server.js` as rotas `/api/gastos*`, `/api/estoque*`, `/api/admin/usuarios-estoque*` e seus helpers; dividir o que sobrar em módulos.
4. ~~Fase 4~~ **feita (21/10/2026)**: 016 (rename) e 017 (DROP). Histórico do rename:: migration `016` já renomeia `usuario_restaurante_estoque` para `usuario_restaurantes` (código, testes e E2E atualizados). **Falta** o `DROP` das tabelas e colunas legadas, que depende de confirmação e de validar a 016 em homologação. Plano original: nova migration para renomear `usuario_restaurante_estoque` para `usuario_restaurantes` e, só depois de validar, `DROP` das tabelas e colunas legadas. Confirmar antes de qualquer `DROP`.
5. Fase 5: `JWT_SECRET` obrigatório em produção (falhar se ausente), reduzir logs de login, baixar o limite de `express.json` (hoje 50mb), rate limit no login.
6. Opcional: lacunas conhecidas — seletor para trocar de restaurante durante o uso (só confirmei a escolha inicial) e testes de tela / E2E com Playwright e Postgres real.

## 6. Como retomar no WSL
- Reinstalar dependências no ambiente novo (os `node_modules` foram criados no Windows): `npm run install-all` na raiz e `npm install` em `backend/`.
- Backend: `cd backend && npm test` (sobe o Postgres de teste sozinho).
- Frontend: `cd frontend && CI=true npx react-scripts test --watchAll=false`.
- **Conexão com a homologação:** as variáveis (`DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `JWT_SECRET`) estavam no `C:\IT\prd\ws\controle-financeiro.code-workspace` (setting `terminal.integrated.env.windows`), fora do repositório. No WSL elas **não** são herdadas: exporte-as no shell ou crie `backend/.env` a partir de `backend/.env.example` (já ignorado pelo git). Nunca commite senhas.
- Migrar: `cd backend && npm run migrate` (com as variáveis exportadas). Antes, confirme que `DB_NAME` é o de homologação.
- Observação: o Claude Code no WSL tem um diretório de memória e de projeto diferente do Windows. Este arquivo e o `CLAUDE.md` são a fonte de contexto que acompanha o repositório.

## 8. Docker atualizado (23/10/2026)
- `backend/Dockerfile`: `NODE_ENV=production`, usuário `node`, `HEALTHCHECK` em `/api/health`, e `CMD` que roda `database/migrate.js` e depois `exec node dist/server.js` (`RUN_MIGRATIONS=0` pula). Antes o `CMD` só iniciava a API, sem migration.
- `frontend/Dockerfile`: `npm ci` (antes `npm install`), `nginx.conf` em arquivo próprio (cache longo em `/static/`, `index.html` sem cache, gzip), `HEALTHCHECK`. Novo `frontend/.dockerignore`; `backend/.dockerignore` ampliado.
- Novo `docker-compose.yml` (db + api + web) para validar as imagens localmente. Novo guia `docs/DEPLOY-DOCKER.md`.
- Validado com `docker compose up --build` no WSL: 17 migrations aplicadas, API e web `healthy`, health 200, fallback de SPA, login inválido 401, `create_admin.js` no container, SIGTERM gracioso (~1 s). Não testado: fluxo de boletos pela interface e o deploy real no Easypanel.
- Docs: `README.md`, `TESTING.md` e `setup.md` reescritos para o projeto atual (sem gastos/estoque); removido `backend/env.example` (duplicava `.env.example`, com senha de exemplo); aviso de "desatualizado" nos 9 guias `*_EASYPANEL.md` que citam `node server.js`.
- Pendente: imagens base `node:18-alpine` e `nginx:alpine` com vulnerabilidades apontadas pelo IDE (Node 18 sem suporte); subir exige ajustar `@types/node`, o CI e testar o CRA.

## 9. Verificação de migrations no boot e no health (23/10/2026)
- **Problema:** o backend novo (tabela `usuario_restaurantes`, migration 016) rodou contra um banco ainda na 015 e a API devolveu 500 genérico "relation usuario_restaurantes does not exist" só na primeira requisição que tocava a tabela. Homologação e produção ainda estão em código antigo: 016 e 017 **não** foram aplicadas lá.
- **Solução:**
  - `backend/database/lista-migrations.js`: lista única e ordenada (`{ MIGRATIONS }`), usada por `migrate.js` e pela API. Migration nova precisa entrar aí.
  - `backend/lib/migracoes.ts`: `migracoesPendentes(pool)` compara a lista com `schema_migrations`.
  - `GET /api/health/ready` (e `/health`): 200 com `migrations:'ok'`; 503 com `migrations:'pending'` e `pendentes`; 503 `database:'disconnected'`. `GET /api/health` (liveness, usado no `HEALTHCHECK`) não mudou.
  - No boot: log de erro com as pendentes e `node database/migrate.js (faça pg_dump antes)`; não encerra o processo nem aplica migrations.
  - Tabela inexistente (`42P01`) em admin, restaurantes, auth/verify e boletos responde 503 `Banco desatualizado: migrations pendentes. Veja /api/health/ready.`
- **Testes:** `test/upgrade.test.js` (banco isolado `controle_financeiro_upgrade_test`: estado 015 com dados, aplica 016+017, confere vínculos, índices, boletos/metas e idempotência), `test/healthMigrations.test.js` e `health.test.js` ajustado. Validado: typecheck, build e 147 testes.
- **Pendências:**
  - (a) `requireModuloBoletos` e `loadUserFlags` não têm try/catch: se o banco falhar ali, o Express 4 não captura a rejeição e a requisição pode pendurar (tarefa separada).
  - (b) Só `GET /api/admin/usuarios-permissoes` tem teste do 503 de tabela inexistente; POST/PUT/DELETE de admin e as rotas de boletos não têm.
  - (c) O teste de upgrade não semeia dados em gastos/estoque.
  - Aplicar 016 e 017 em homologação/produção continua pendente (ver `docs/DEPLOY-DOCKER.md`).

## 7. Migração do backend para TypeScript (21/10/2026)
- `server`, `db`, `routes/*`, `middleware/*`, `lib/*` agora são `.ts`; novos: `lib/tipos.ts`, `lib/erros.ts`, `lib/loadEnv.ts` e `backend/tsconfig.json` (`strict`, CommonJS, saída em `dist/`). `database/` e `scripts/` seguem em JS. Jest usa `ts-jest`.
- Scripts do back: `dev` (nodemon + tsx), `build` (`tsc`), `typecheck` (`tsc --noEmit`), `start` (`node dist/server.js`), `start:prod` (`node database/migrate.js && node dist/server.js`).
- `typescript` fixado em `~5.9`: a 7.x quebra `moduleResolution: node`.
- `backend/Dockerfile` em dois estágios (build com `npm ci` + `tsc`; runtime com `npm ci --omit=dev`, `dist/` e `database/`). Adicionado `backend/.dockerignore` (evita copiar `node_modules`/`.env` do host).
- CI: o job `backend` roda `npm run typecheck` e `npm run build` antes do Jest.
- **Easypanel:** o Comando de Início da API deve ser `npm run start:prod` (migrations + `node dist/server.js`) ou, sem migration automática, `npm start`; `node server.js` não existe mais. Atualizar antes do primeiro deploy após o merge.
- `docker build ./backend` testado (Docker no WSL, distro `Ubuntu`) em 22/10/2026: build concluído, incluindo `npm ci` e `tsc`. O container não foi executado (`node dist/server.js` não foi testado).

## 10. Migração do frontend para TypeScript estrito (23/10/2026)
- Branch `feat/frontend-typescript-estrito` (sem commit ainda). O front deixa de misturar `.js` e `.tsx`: tudo em `.ts`/`.tsx`.
- Renomeados: `App.js`->`App.tsx`, `config.js`->`config.ts`, `Login.js`->`Login.tsx`, `CadastroRestaurantes.js`->`CadastroRestaurantes.tsx`, `lib/userPermissoes.js`->`.ts`, `setupTests.js`->`.ts`, `Login.test.js`->`.tsx`, `userPermissoes.test.js`->`.ts`. `AdminPermissoesUsuarios.tsx` e `BoletosModulo.tsx` ajustados.
- Novos: `frontend/src/types.ts` (tipos compartilhados da API) e `frontend/src/lib/erros.ts` (`mensagemErro(error: unknown, fallback)`).
- `frontend/tsconfig.json`: `allowJs=false`, `strict`, `noImplicitReturns`, `noUnusedLocals`, `noUnusedParameters`, `noUncheckedIndexedAccess`.
- `@types/jest` `^27.5.2` em `devDependencies` do front. O CI já roda `npx tsc --noEmit` no job `frontend`; nenhuma mudança de workflow, Dockerfile ou regra de negócio.
- Docs atualizadas: `CLAUDE.md` (stack, comandos, caminhos, regra de TS estrito sem `any` e `types.ts` alinhado ao back), agentes `frontend-ui`/`qa-tests`/`devops-docs`, `README.md`, `TESTING.md`, `setup.md`, `docs/DEPLOY-DOCKER.md`. Menções a `.js` nas seções anteriores deste arquivo e nos guias `*_EASYPANEL.md`/`MODULO_ESTOQUE.md`/`docs/PLANO-DE-ACAO.md` foram mantidas como registro histórico.
- Pendências:
  - Tipos `Boleto`, `SemanaResumo` e `Meta` em `types.ts` ainda não foram conferidos linha a linha contra `backend/routes/boletos.ts`; o `qa-tests` está conferindo.
  - E2E (Playwright) está sendo rodado pelo `qa-tests`; resultado ainda não registrado aqui.
  - Faltam commit e validação do build do front (`CI=true npx react-scripts build`) após a migração.

## 11. Boleto por imagem (Gemini), baixa de pagamento e soft delete (23/10/2026)
- Branch `feat/boleto-por-imagem` (sem commit ainda). Migration `018` (aditiva): campos de fornecedor, linha digitável (única global entre não excluídos), pagamento, `deleted_at`, anexos e ocorrências; flag `usuarios.pode_marcar_pago`.
- Entrega: `backend/Dockerfile` copia `scripts/`; `docker-compose.yml` ganhou as variáveis opcionais do Gemini/retenção/rate limit (a versão inicial com `UPLOADS_DIR` e volume `uploads_data` foi substituída pelo MinIO, ver abaixo). `frontend/nginx.conf` não mudou (não faz proxy da API). CI sem mudança (testes usam extrator injetado, sem Gemini real).
- Docs: `docs/DEPLOY-DOCKER.md` (variáveis, volume no Easypanel, backup, limpeza, LGPD, problemas comuns) e `CLAUDE.md`.
- Ajustes posteriores: variáveis opcionais `GEMINI_BASE_URL` e `GEMINI_TIMEOUT_MS` (compose e docs); boleto pago travado (PUT/DELETE só admin, 403 aos demais); `limpar-boletos` apaga o banco antes do arquivo, rejeita `--dry-run` com `--confirmar` e remove `boletos_ocorrencias` além da retenção; CORS expõe `Retry-After` e `Content-Disposition`.
- Armazenamento (decisão do dono): serviço externo S3-compatível, **MinIO**, via `STORAGE_ENDPOINT/BUCKET/ACCESS_KEY/SECRET_KEY` (+ `STORAGE_REGION`, `STORAGE_FORCE_PATH_STYLE`). Removidos `UPLOADS_DIR`, o `ENV`/`mkdir`/`VOLUME` do `backend/Dockerfile` e o volume `uploads_data`. No `docker-compose.yml`: serviços `minio` (volume `minio_data`, portas só em 127.0.0.1, healthcheck) e `minio-init` (cria o bucket privado, idempotente); a `api` depende do init. Imagem usada: `cgr.dev/chainguard/minio` porque `minio/minio` e `minio/mc` não existem mais no Docker Hub e o quay.io exige login (variável `MINIO_IMAGE`). Em produção o MinIO é serviço separado/externo, com usuário restrito ao bucket (guia em `docs/DEPLOY-DOCKER.md`). Sem imagens a migrar: a feature não foi publicada.
- Fluxo novo: a extração é em memória; o anexo só é gravado após confirmar o boleto. Teto diário de 30 leituras por IA por usuário (`EXTRAIR_LIMITE_DIARIO`, tabela `boletos_extracoes_uso`, migration 019). `limpar-boletos` só apaga objetos com `STORAGE_*` definido.
- Validado: `docker compose config`; `minio` healthy e `minio-init` criando o bucket privado (repetível); `docker build ./backend` e `@aws-sdk/client-s3` carregando no Node 18.20.8 (avisos `EBADENGINE` de transitivas que pedem Node 20). Não validado: `api` + MinIO ponta a ponta. CI do MinIO a definir com o `qa-tests`.
- Auditoria de segurança: sem achados críticos ou altos; bugs encontrados foram corrigidos (ver ajustes acima). O teto diário de leituras por IA foi implementado; o teto de anexos órfãos segue a decidir.
- Pendências: validar `docker build ./backend`, `docker compose up --build` e a limpeza dentro da imagem (não rodados por falta de Docker no ambiente); criar o MinIO, o bucket privado e o usuário restrito no Easypanel (ou S3 externo) e definir `STORAGE_*` antes do deploy; definir `GEMINI_API_KEY` (plano pago) e `BOLETOS_RETENCAO_DIAS` nos ambientes.
