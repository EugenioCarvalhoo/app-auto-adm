# Guia de configuração rápida (desenvolvimento)

Para rodar com Docker, veja [docs/DEPLOY-DOCKER.md](./docs/DEPLOY-DOCKER.md).

## 1. Instalar dependências
```bash
npm run install-all        # raiz + frontend + e2e
cd backend && npm install  # backend (package.json próprio, com as devDependencies: nodemon, tsx, typescript)
```
O `install-all` **não** instala o backend. Sem o `npm install` em `backend/`, `nodemon` e `tsx` não são reconhecidos.

## 2. PostgreSQL
Crie o banco:
```sql
CREATE DATABASE controle_financeiro;
```
Copie o modelo e edite:
```bash
# Windows PowerShell
Copy-Item backend\.env.example backend\.env
# Linux/Mac
cp backend/.env.example backend/.env
```
```
DB_HOST=localhost
DB_PORT=5432
DB_NAME=controle_financeiro
DB_USER=seu_usuario
DB_PASSWORD=sua_senha
JWT_SECRET=uma_chave_longa_e_aleatoria
PORT=5000
```

## 3. Migrations e admin
```bash
npm run migrate
npm run create-admin       # admin / admin123 — troque a senha depois
```

## 4. Iniciar
```bash
npm run dev                # API (nodemon + tsx) e front juntos
```
Ou em dois terminais: `cd backend && npm run dev` e `cd frontend && npm start`.
Acesse `http://localhost:3000`. A API fica em `:5000`.

No frontend, `npm start` usa `cross-env`; se não for reconhecido, rode `npm install` em `frontend/`. Em Linux/WSL também existe `npm run start:unix`.

## Solução de problemas
- **`nodemon`/`tsx` não reconhecido:** falta `npm install` em `backend/`.
- **`cross-env` não reconhecido:** falta `npm install` em `frontend/`.
- **Erro de conexão com o banco:** confira se o PostgreSQL está no ar e as credenciais em `backend/.env`.
- **Migrations falham:** o banco precisa existir e o usuário precisa de permissão para criar tabelas.
- **Porta em uso:** mude `PORT` em `backend/.env` (e a URL da API no front, em `frontend/src/config.js` ou `REACT_APP_API_URL`).
