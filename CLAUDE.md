# Controle Financeiro — Boletos/Notas + Auth multi-restaurante

Sistema web para restaurantes. Escopo ativo: **(1) cadastro de boletos/notas com dashboard semanal e metas**, **(2) autenticação/autorização de usuários com separação por restaurante**. Todo o resto é legado em processo de remoção (ver `docs/PLANO-DE-ACAO.md`).

## Stack
- **Backend:** Node + Express 4 em **TypeScript** (compilado com `tsc` para `backend/dist/`), PostgreSQL (`pg`, SQL direto, sem ORM), JWT (`jsonwebtoken`), `bcryptjs`. `backend/server.ts` só monta o app; o resto fica em `routes/`, `middleware/`, `lib/` e `db.ts`. `typescript` fica fixado em `~5.9` (7.x quebra `moduleResolution: node`); não suba sem ajustar o `tsconfig.json`. `database/` (migrate, create_admin) e `scripts/` continuam JS.
- **Frontend:** React 18 (Create React App), **TypeScript estrito** (`allowJs=false`, `strict`, `noImplicitReturns`, `noUnusedLocals`, `noUnusedParameters`, `noUncheckedIndexedAccess`; só `.ts`/`.tsx`), `axios`. Navegação por estado (`telaAtual` em `frontend/src/App.tsx`), sem router.
- **Deploy:** Easypanel com Docker (`backend/Dockerfile` multi-stage com `tsc`, roda como `node`, com HEALTHCHECK; `frontend/Dockerfile` com build do CRA + nginx via `frontend/nginx.conf`). O `CMD` da API já roda `node database/migrate.js` e depois `exec node dist/server.js` (`RUN_MIGRATIONS=0` pula as migrations); com o builder Dockerfile o `CMD` vale (o Comando de Início do Easypanel é de Railpack/Nixpacks; não deixe um antigo sobrescrevendo). Front e API em hosts diferentes: `REACT_APP_API_URL` é variável do serviço web, que o Easypanel repassa como build arg (o Dockerfile declara o `ARG`) (ver `frontend/src/config.ts`). Guia: `docs/DEPLOY-DOCKER.md`.

## Comandos
```bash
npm run install-all          # raiz + frontend + e2e (backend usa o package.json de backend/)
npm run dev                  # back (nodemon) + front juntos
npm run migrate              # aplica backend/database/migrations
npm run create-admin         # cria usuário admin
cd backend && npm run typecheck && npm run build   # tsc --noEmit / compila para dist/
cd backend && npm start      # node dist/server.js (precisa do build)
cd backend && npm run start:prod   # migrate + node dist/server.js (equivale ao CMD da imagem Docker)
docker compose up --build    # db + api + web locais (precisa de JWT_SECRET); ver docs/DEPLOY-DOCKER.md
cd backend && npm test       # sobe o Postgres de teste (Docker) se preciso e roda Jest + Supertest (ver backend/test/README.md)
cd frontend && npx tsc --noEmit   # typecheck do front (estrito)
cd frontend && CI=true npm test
cd e2e && npm test          # Playwright (Chromium) com Postgres real; ver e2e/README.md
```
Back em `:5000`, front em `:3000`. Variáveis em `backend/.env` (modelo: `backend/.env.example`). `JWT_SECRET` é obrigatório em produção.

## Arquivos do escopo ativo
- `backend/server.ts` — monta o Express (CORS, log, routers). Rotas em `backend/routes/`: `auth.ts` (`loginHandler`, `/api/verify`), `restaurantes.ts`, `boletos.ts` (`/api/boletos*`, metas), `admin.ts` (`/api/admin/usuarios-permissoes*`), `health.ts`. Tipos/erros/env em `lib/tipos.ts`, `lib/erros.ts`, `lib/loadEnv.ts`.
- `backend/db.ts` — pool do Postgres.
- `backend/database/lista-migrations.js` — lista única e ordenada das migrations (`{ MIGRATIONS }`), usada por `migrate.js` e pela API. **Toda migration nova DEVE ser adicionada aí**, senão `migrate.js` não a aplica (há teste que cobre).
- `backend/lib/migracoes.ts` — `migracoesPendentes(pool)`: compara a lista com `schema_migrations`. Usada por `GET /api/health/ready` (200 `migrations:'ok'`; 503 com `migrations:'pending'` e `pendentes`) e pelo boot, que loga erro destacado se faltar migration, sem encerrar o processo nem aplicá-las. `GET /api/health` continua liveness (sem banco).
- Tabela inexistente (Postgres `42P01`) em admin, restaurantes, auth/verify e boletos responde 503 `Banco desatualizado: migrations pendentes. Veja /api/health/ready.`
- `backend/middleware/auth.ts` — `authenticateToken` (valida JWT). `backend/middleware/permissoes.ts` — `loadUserFlags`, `requireAdmin`, `requireModuloBoletos`, `assertBoletosAcessoRestaurante`, `usuarioRestaurantesRestritos`.
- `backend/lib/boletos.ts` — helpers de boleto (valor, datas, enriquecimento).
- `backend/lib/boletosSemana.ts` — semana sábado–sexta, vencimento efetivo, tipo (testado em `backend/test/boletosSemana.test.js`).
- `backend/database/migrations/` — `002` usuarios, `003_create_restaurantes`, `007` vínculo usuário↔restaurante, `013` flags de módulo, `014` boletos, `015` vínculos da regra nova, `016` rename do vínculo, `017` remove gastos/estoque e flags legadas.
- `frontend/src/components/boletos/BoletosModulo.tsx|css` — tela de boletos, resumo semanal, metas.
- `frontend/src/lib/boletosSemana.ts`, `frontend/src/lib/userPermissoes.ts`, `frontend/src/lib/erros.ts` (`mensagemErro(error: unknown, fallback)`).
- `frontend/src/types.ts` — tipos compartilhados da API (devem refletir `backend/routes` e `backend/lib/tipos.ts`).
- `frontend/src/components/Login.tsx`, `AdminPermissoesUsuarios.tsx`, `CadastroRestaurantes.tsx`, `frontend/src/App.tsx`, `frontend/src/config.ts`.

## Regra de negócio de acesso (definida pelo dono do projeto)
- **Admin:** acesso total e CRUD de tudo (restaurantes, usuários, permissões, boletos, metas) em todos os restaurantes.
- **Demais usuários:** só acessam o que o admin liberar — a funcionalidade de boletos (`modulo_boletos`) **e** cada restaurante vinculado. Sem vínculo, não veem nada. Não gerenciam restaurantes nem usuários.
- Não existe acesso livre a todos os restaurantes para não-admin (o antigo `modulo_financeiro` foi removido). A migration 015 vinculou quem o tinha a todos os restaurantes ativos, para ninguém perder acesso; o admin ajusta depois.

## Modelo de autorização (importante)
- `usuarios`: `is_admin` + flag `modulo_boletos` (as legadas `modulo_financeiro`, `modulo_estoque*`, `somente_estoque` foram removidas na migration 017).
- Admin acessa tudo. Demais usuários dependem de `modulo_boletos`.
- Separação por restaurante: tabela **`usuario_restaurantes`** (renomeada da `usuario_restaurante_estoque` na migration 016; vincula usuário↔restaurante). Checada por `assertBoletosAcessoRestaurante` e `usuarioRestaurantesRestritos` em `middleware/permissoes.ts`.
- **Flags são lidas do banco a cada requisição** (`loadUserFlags`), não confie só no JWT.
- Toda rota que recebe `:id` de boleto/meta deve buscar o registro e validar o `restaurante_id` dele (padrão já usado em PUT/DELETE de boletos). Mantenha esse padrão em rotas novas.

## Regras para o Claude
- **Não** adicione funcionalidade de gastos, relatórios ou estoque; estão em remoção.
- Valores monetários: `NUMERIC(14,2)` no banco; arredonde em centavos ao somar (`Math.round(x*100)/100`).
- Datas de boleto são `DATE` sem fuso; use `hojeBrasil()` (America/Sao_Paulo) para "hoje".
- Não escreva migrations destrutivas (`DROP`) sem confirmar com o usuário (a 017 foi confirmada pelo dono em 21/10/2026). Faça backup antes de aplicá-las.
- Sempre filtrar queries por `restaurante_id` e validar acesso com `assertBoletosAcessoRestaurante`.
- Antes de mexer em auth, rode `cd backend && npm test`. O CI roda `typecheck` e `build` antes do Jest. O script sobe sozinho o Postgres de teste (container `pg-controle`, porta 5433); os testes só rodam em banco terminado em `_test`.
- Mudanças em contrato de API: atualizar back, `BoletosModulo.tsx` e `frontend/src/types.ts` na mesma tarefa.
- Todo código novo do frontend é `.ts`/`.tsx`, sem `any` (nem implícito). Tipos da API ficam em `frontend/src/types.ts`, alinhados a `backend/routes` e `backend/lib/tipos.ts`.

## Agentes por camada (`.claude/agents/`)
| Agente | Responsabilidade | Edita |
|---|---|---|
| `backend-api` | rotas, middlewares, regra de acesso | `backend/{routes,middleware,lib,db.ts,server.ts}` |
| `database-migrations` | schema, migrations (DROP só com confirmação) | `backend/database/` |
| `frontend-ui` | telas, componentes, axios | `frontend/src` |
| `qa-tests` | **todos os testes**: unitários e de integração do back (Jest), front, Playwright; reporta bugs sem corrigir produção | `backend/test`, `e2e/`, `*.test.ts(x)` do front |
| `security-reviewer` | auditoria somente-leitura (IDOR, auth, segredos) | nada |
| `devops-docs` | CI, Docker, deploy, documentação | `.github/`, Dockerfiles, `docs/`, `CLAUDE.md` |

Fluxo para mudança que atravessa camadas: `database-migrations` (schema) → `backend-api` (contrato) → `frontend-ui` (mesma tarefa, conforme "Regras para o Claude") → `qa-tests` (cobertura) → `security-reviewer` (se mexeu em auth/acesso) → `devops-docs` (docs/CI). Cada agente devolve ao dono da camada o que está fora do seu escopo.

## Docker faz parte do requisito
Mudou comando de início, porta, variável de ambiente, migration, `package.json` ou o build do front? Atualize `backend/Dockerfile`, `frontend/Dockerfile`, `docker-compose.yml` e `docs/DEPLOY-DOCKER.md` na mesma tarefa, e valide com `docker compose up --build` (o CI só confere o `docker build`).

## Documentação
Deploy e Docker: `docs/DEPLOY-DOCKER.md` (guia atual). Histórico das etapas já feitas, decisões e próximos passos: `docs/HISTORICO-ETAPAS.md` (leia primeiro ao retomar o trabalho).
Os guias `*_EASYPANEL.md` na raiz são históricos de troubleshooting de deploy; só consulte se o problema for deploy. Plano de limpeza: `docs/PLANO-DE-ACAO.md`.
