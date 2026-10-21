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

### Regra de acesso (backend — `backend/server.js`)
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
- Build do front no CI usa `CI=false` porque, com `CI=true`, avisos de lint de `App.js`, `GridEditavel` e `Relatorios` viram erro. Remover isso depois da limpeza dos módulos legados.
- Pendente do usuário: criar branch `homologacao`; criar secrets `EASYPANEL_HML_API_WEBHOOK`, `EASYPANEL_HML_WEB_WEBHOOK`, `EASYPANEL_PROD_API_WEBHOOK`, `EASYPANEL_PROD_WEB_WEBHOOK`; criar ambientes `homologacao` e `producao` (reviewers na produção); desligar o deploy automático por push no Easypanel. A migration continua manual (`npm run migrate` no terminal do back) ou via Comando de Início `node database/migrate.js && node server.js`.

### Homologação (banco `financialmanagementbdhomolog`)
- Migration executada: `001` a `015` aplicadas; segunda execução pulou todas.
- Antes: 1 usuário (admin), 2 restaurantes, 6 boletos. A `015` não alterou vínculos (só havia o admin).
- Teste manual do dono: usuário `Test` (não-admin, só boletos, vinculado a 2 restaurantes) viu os dois na escolha inicial e cadastrou boleto em cada um. Confirmado no banco: boletos `id` 10 (restaurante 1) e 11 (restaurante 2), ambos com autor `Test`.
- Esses dois boletos de teste e o usuário `Test` continuam em homologação.

## 4. Estado atual e pendências
- **Nada foi commitado.** Todas as mudanças estão no disco. Antes de trocar de ambiente, faça commit (ou garanta que o WSL abre a mesma pasta, ex.: `/mnt/c/IT/prd/controle-financeiro`).
- `frontend/package.json` tem alteração sua não commitada: o script `start` perdeu o `cross-env HOST=0.0.0.0`. No WSL/Linux, `start:unix` ou `HOST=0.0.0.0 react-scripts start` resolve; decida qual manter.
- **Deploy do código novo em homologação ainda não confirmado.** A migration já está no banco; a regra só vale com o back e o front novos publicados. (O teste manual com o `Test` funcionou; confirme que foi com o código novo.)
- O `Dockerfile` do back só roda `node server.js`: a migration não roda sozinha no deploy. Executar `npm run migrate` manualmente nos ambientes (produção ainda não foi migrada).
- Não testado em homologação: o lado negativo (usuário não ver restaurante não liberado). Está coberto só pelos testes automatizados.
- Não executei `npm run build` do frontend.

## 5. Próximos passos (ordem sugerida)
1. Commit em branch (ex.: `regra-acesso-admin`) com a regra, a `015`, o `migrate.js`, os testes e os docs.
2. Fase 2: remover o front legado (`GridEditavel`, `Relatorios`, `components/estoque/`, `Estoque.css`, `AdminUsuariosEstoque`), simplificar `App.js`, `AdminDashboard.tsx` e `userPermissoes.js`.
3. Fase 3: remover do `server.js` as rotas `/api/gastos*`, `/api/estoque*`, `/api/admin/usuarios-estoque*` e seus helpers; dividir o que sobrar em módulos.
4. Fase 4: nova migration (ex.: `016`) para renomear `usuario_restaurante_estoque` para `usuario_restaurantes` e, só depois de validar, `DROP` das tabelas e colunas legadas. Confirmar antes de qualquer `DROP`.
5. Fase 5: `JWT_SECRET` obrigatório em produção (falhar se ausente), reduzir logs de login, baixar o limite de `express.json` (hoje 50mb), rate limit no login.
6. Opcional: lacunas conhecidas — seletor para trocar de restaurante durante o uso (só confirmei a escolha inicial) e testes de tela / E2E com Playwright e Postgres real.

## 6. Como retomar no WSL
- Reinstalar dependências no ambiente novo (os `node_modules` foram criados no Windows): `npm run install-all` na raiz e `npm install` em `backend/`.
- Backend: `cd backend && npm test` (sobe o Postgres de teste sozinho).
- Frontend: `cd frontend && CI=true npx react-scripts test --watchAll=false`.
- **Conexão com a homologação:** as variáveis (`DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `JWT_SECRET`) estavam no `C:\IT\prd\ws\controle-financeiro.code-workspace` (setting `terminal.integrated.env.windows`), fora do repositório. No WSL elas **não** são herdadas: exporte-as no shell ou crie `backend/.env` a partir de `backend/.env.example` (já ignorado pelo git). Nunca commite senhas.
- Migrar: `cd backend && npm run migrate` (com as variáveis exportadas). Antes, confirme que `DB_NAME` é o de homologação.
- Observação: o Claude Code no WSL tem um diretório de memória e de projeto diferente do Windows. Este arquivo e o `CLAUDE.md` são a fonte de contexto que acompanha o repositório.
