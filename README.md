# Controle Financeiro — Boletos/Notas

Sistema web para restaurantes: cadastro de boletos e notas com dashboard semanal e metas, e autenticação com separação por restaurante.

- **Admin:** acesso total (restaurantes, usuários, permissões, boletos, metas).
- **Demais usuários:** só o que o admin liberar — o módulo de boletos **e** cada restaurante vinculado.

Regras detalhadas e arquitetura: [CLAUDE.md](./CLAUDE.md). Histórico das etapas: [docs/HISTORICO-ETAPAS.md](./docs/HISTORICO-ETAPAS.md).

## Tecnologias
- **Backend:** Node, Express 4, TypeScript, PostgreSQL (`pg`), JWT.
- **Frontend:** React 18 (Create React App), axios.
- **Entrega:** Docker (uma imagem para a API, outra para o front com nginx), Easypanel, GitHub Actions.

## Pré-requisitos
- Node.js 20+
- PostgreSQL 12+ (ou Docker)

## Rodar em desenvolvimento
```bash
npm run install-all          # raiz + frontend + e2e
cd backend && npm install    # o backend tem package.json próprio (inclui as devDependencies)
```

Crie o banco `controle_financeiro` e o arquivo de variáveis:
```bash
cp backend/.env.example backend/.env     # Windows: Copy-Item backend\.env.example backend\.env
# edite DB_* e JWT_SECRET
npm run migrate
npm run create-admin                     # admin / admin123 — troque a senha
npm run dev                              # API em :5000 e front em :3000
```

## Rodar com Docker
```bash
export JWT_SECRET=$(openssl rand -hex 32)
docker compose up --build                # front em :8080, API em :5000
docker compose exec api node database/create_admin.js
```
Imagens, variáveis, `REACT_APP_API_URL` e passo a passo do Easypanel: [docs/DEPLOY-DOCKER.md](./docs/DEPLOY-DOCKER.md).

## Testes
```bash
cd backend && npm test                   # Jest + Supertest com Postgres real (Docker)
cd frontend && CI=true npm test
cd e2e && npm test                       # Playwright
```
Veja [TESTING.md](./TESTING.md).

## Estrutura
```
├── backend/
│   ├── src/                 # NestJS: main.ts, módulos acesso/auth/restaurantes/boletos/admin/health/shared/config
│   │                        # (cada um em domain/application/infrastructure/presentation)
│   ├── database/            # migrate.js, create_admin.js, migrations/
│   ├── test/                # Jest + Supertest
│   └── Dockerfile
├── frontend/
│   ├── src/                 # App.tsx, components/ (boletos, login, admin), lib/
│   ├── nginx.conf
│   └── Dockerfile
├── e2e/                     # Playwright
├── docs/                    # histórico, plano de ação, deploy com Docker
├── docker-compose.yml       # stack local (db + api + web)
└── .github/workflows/       # CI e deploy
```
