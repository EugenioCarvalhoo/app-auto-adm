# Controle Financeiro — Boletos/Notas + Auth multi-restaurante

Sistema web para restaurantes. Escopo ativo: **(1) cadastro de boletos/notas com dashboard semanal e metas**, **(2) autenticação/autorização de usuários com separação por restaurante**. Todo o resto é legado em processo de remoção (ver `docs/PLANO-DE-ACAO.md`).

## Stack
- **Backend:** Node + Express 4, PostgreSQL (`pg`, SQL direto, sem ORM), JWT (`jsonwebtoken`), `bcryptjs`. `backend/server.js` só monta o app; o resto fica em `routes/`, `middleware/`, `lib/` e `db.js`.
- **Frontend:** React 18 (Create React App), mistura de `.js` e `.tsx`, `axios`. Navegação por estado (`telaAtual` em `frontend/src/App.js`), sem router.
- **Deploy:** Easypanel (Dockerfile em `backend/` e `frontend/`). Front e API em hosts diferentes (ver `frontend/src/config.js`).

## Comandos
```bash
npm run install-all          # raiz + frontend + e2e (backend usa o package.json de backend/)
npm run dev                  # back (nodemon) + front juntos
npm run migrate              # aplica backend/database/migrations
npm run create-admin         # cria usuário admin
cd backend && npm test       # sobe o Postgres de teste (Docker) se preciso e roda Jest + Supertest (ver backend/test/README.md)
cd frontend && CI=true npm test
cd e2e && npm test          # Playwright (Chromium) com Postgres real; ver e2e/README.md
```
Back em `:5000`, front em `:3000`. Variáveis em `backend/.env` (modelo: `backend/.env.example`). `JWT_SECRET` é obrigatório em produção.

## Arquivos do escopo ativo
- `backend/server.js` — monta o Express (CORS, log, routers). Rotas em `backend/routes/`: `auth.js` (`loginHandler`, `/api/verify`), `restaurantes.js`, `boletos.js` (`/api/boletos*`, metas), `admin.js` (`/api/admin/usuarios-permissoes*`), `health.js`.
- `backend/db.js` — pool do Postgres.
- `backend/middleware/auth.js` — `authenticateToken` (valida JWT). `backend/middleware/permissoes.js` — `loadUserFlags`, `requireAdmin`, `requireModuloBoletos`, `assertBoletosAcessoRestaurante`, `usuarioRestaurantesRestritos`.
- `backend/lib/boletos.js` — helpers de boleto (valor, datas, enriquecimento).
- `backend/lib/boletosSemana.js` — semana sábado–sexta, vencimento efetivo, tipo (testado em `backend/test/boletosSemana.test.js`).
- `backend/database/migrations/` — `002` usuarios, `003_create_restaurantes`, `007` vínculo usuário↔restaurante, `013` flags de módulo, `014` boletos.
- `frontend/src/components/boletos/BoletosModulo.tsx|css` — tela de boletos, resumo semanal, metas.
- `frontend/src/lib/boletosSemana.ts`, `frontend/src/lib/userPermissoes.js`.
- `frontend/src/components/Login.js`, `AdminPermissoesUsuarios.tsx`, `CadastroRestaurantes.js`, `App.js`, `config.js`.

## Regra de negócio de acesso (definida pelo dono do projeto)
- **Admin:** acesso total e CRUD de tudo (restaurantes, usuários, permissões, boletos, metas) em todos os restaurantes.
- **Demais usuários:** só acessam o que o admin liberar — a funcionalidade de boletos (`modulo_boletos`) **e** cada restaurante vinculado. Sem vínculo, não veem nada. Não gerenciam restaurantes nem usuários.
- Não existe mais acesso livre a todos os restaurantes para não-admin (o antigo `modulo_financeiro` será removido). Na migration, quem tinha `modulo_financeiro` é vinculado a todos os restaurantes ativos, para ninguém perder acesso; o admin ajusta depois.

## Modelo de autorização (importante)
- `usuarios`: `is_admin` + flags `modulo_boletos` (e legadas `modulo_financeiro`, `modulo_estoque*`, `somente_estoque`).
- Admin acessa tudo. Demais usuários dependem de `modulo_boletos`.
- Separação por restaurante: tabela **`usuario_restaurante_estoque`** (nome legado; vincula usuário↔restaurante). Checada por `assertBoletosAcessoRestaurante` e `usuarioRestaurantesRestritos` em `middleware/permissoes.js`.
- **Flags são lidas do banco a cada requisição** (`loadUserFlags`), não confie só no JWT.
- Toda rota que recebe `:id` de boleto/meta deve buscar o registro e validar o `restaurante_id` dele (padrão já usado em PUT/DELETE de boletos). Mantenha esse padrão em rotas novas.

## Regras para o Claude
- **Não** adicione funcionalidade de gastos, relatórios ou estoque; estão em remoção.
- Valores monetários: `NUMERIC(14,2)` no banco; arredonde em centavos ao somar (`Math.round(x*100)/100`).
- Datas de boleto são `DATE` sem fuso; use `hojeBrasil()` (America/Sao_Paulo) para "hoje".
- Não escreva migrations destrutivas (`DROP`) sem confirmar com o usuário; aplique a remoção de tabelas legadas só na fase indicada no plano.
- Sempre filtrar queries por `restaurante_id` e validar acesso com `assertBoletosAcessoRestaurante`.
- Antes de mexer em auth, rode `cd backend && npm test`. O script sobe sozinho o Postgres de teste (container `pg-controle`, porta 5433); os testes só rodam em banco terminado em `_test`.
- Mudanças em contrato de API: atualizar back e `BoletosModulo.tsx` na mesma tarefa.

## Documentação
Histórico das etapas já feitas, decisões e próximos passos: `docs/HISTORICO-ETAPAS.md` (leia primeiro ao retomar o trabalho).
Os guias `*_EASYPANEL.md` na raiz são históricos de troubleshooting de deploy; só consulte se o problema for deploy. Plano de limpeza: `docs/PLANO-DE-ACAO.md`.
