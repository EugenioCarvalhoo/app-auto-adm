# Docker e deploy (Easypanel)

Guia único e atual de containers. Os `*_EASYPANEL.md` da raiz são históricos de troubleshooting e citam comandos antigos (`node server.js`), que não existem mais.

## Imagens

| Serviço | Dockerfile | Porta | O que faz |
|---|---|---|---|
| API | `backend/Dockerfile` | 5000 | Multi-stage: `npm ci` + `tsc` no build; no runtime só dependências de produção, `dist/` e `database/`. Roda como usuário `node`. |
| Web | `frontend/Dockerfile` + `frontend/nginx.conf` | 80 | Multi-stage: build do CRA e nginx servindo o estático, com fallback de SPA para `index.html`. |

Os dois têm `HEALTHCHECK` (API: `GET /api/health`, liveness sem banco; web: `GET /`).

### Comando de início da API
O `CMD` da imagem já aplica as migrations pendentes e inicia a API:

```
node database/migrate.js && exec node dist/server.js
```

- A `migrate.js` é idempotente (registra as aplicadas em `schema_migrations`), então rodar a cada boot é seguro. Se a migration falhar, o container sai e a API não sobe.
- `RUN_MIGRATIONS=0` pula as migrations (o container só inicia a API).
- O `exec` deixa o Node como PID 1, que recebe o `SIGTERM` e encerra com graciosidade.
- Com o builder **Dockerfile**, quem manda é o `CMD` da imagem: a documentação do Easypanel só descreve o campo "Comando de Início" para Railpack e Nixpacks. Se um comando antigo (ex.: `node server.js`) ficou de quando o serviço usava Nixpacks, confira na tela do serviço que ele não está sobrescrevendo o `CMD`; para a API ele deve ficar vazio ou ser `npm run start:prod`. **Nunca** `node server.js`: o arquivo não existe mais.

### Variáveis de ambiente da API
| Variável | Obrigatória | Observação |
|---|---|---|
| `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` | sim | No Easypanel, use o nome interno do serviço Postgres como `DB_HOST` e a porta `5432`. |
| `JWT_SECRET` | sim em produção | Sem ela a API sobe com uma chave padrão pública (só um aviso no log). Gere com `openssl rand -hex 32`. |
| `PORT` | não | Padrão `5000`. O domínio do Easypanel deve apontar para essa porta. |
| `RUN_MIGRATIONS` | não | `0` desliga as migrations no boot. |
| `LOG_HTTP` | não | `0` desliga o log de cada requisição. |

### URL da API no front (`REACT_APP_API_URL`)
O CRA embute `REACT_APP_*` no JavaScript **na hora do build**. Variável de ambiente do container em runtime não muda nada.
- No Easypanel, o Buildx passa as variáveis do serviço como build args, e o Dockerfile só recebe as que declara com `ARG` (o `frontend/Dockerfile` declara `REACT_APP_API_URL`). Então crie `REACT_APP_API_URL` nas **variáveis de ambiente do serviço web**, com a URL pública da API **terminando em `/api`**, ex.: `https://api.exemplo.com/api`. Mudou a URL, refaça o deploy com **Force Rebuild** (o cache do Docker pode reaproveitar o bundle antigo).
- Build args não são mecanismo de segredo: só ponha aqui a URL pública, nunca senha ou token.
- Sem ela, `frontend/src/config.js` deduz o host a partir do hostname (padrão `financialmanagement` para `financialmanagementapp` em `easypanel.host`); fora desse padrão a API não é encontrada.

## Rodar tudo localmente com Docker

Valida as imagens de produção com um Postgres descartável:

```bash
export JWT_SECRET=$(openssl rand -hex 32)      # PowerShell: $env:JWT_SECRET = -join ((1..32) | % { '{0:x2}' -f (Get-Random -Max 256) })
docker compose up --build
```

- Front: `http://localhost:8080` (mude com `WEB_PORT`), API: `http://localhost:5000/api/health`.
- Criar o admin (`admin` / `admin123`, **troque a senha em seguida**): `docker compose exec api node database/create_admin.js`.
- Apagar tudo, inclusive o banco: `docker compose down -v`.
- A URL da API embutida no front é `http://localhost:5000/api`. Para outra, passe `REACT_APP_API_URL` ao `docker compose build`.

O `docker-compose.yml` serve só para isso; o Easypanel não o usa.

## Easypanel: passo a passo

1. **Postgres:** crie o serviço de banco e o database.
2. **API:** novo serviço "App" a partir do GitHub, **Build: Dockerfile**, Variáveis da tabela acima. Domínio apontando para a porta `5000`. **Build Path** `/backend` (é também o contexto do build; o Dockerfile não copia nada de fora dele).
3. **Web:** novo serviço "App", **Build: Dockerfile**, **Build Path** `/frontend`. Variável `REACT_APP_API_URL` (ver acima). Domínio apontando para a porta `80`.
4. **Primeira vez:** abra o terminal da API e rode `node database/create_admin.js` para criar o admin; troque a senha em seguida.
5. **Deploy por CI:** o `.github/workflows/ci-deploy.yml` dispara os webhooks de deploy depois dos testes (ver `docs/HISTORICO-ETAPAS.md`). Desligue o deploy automático por push no Easypanel.

## Antes de publicar uma versão com migrations novas
- A `017` faz `DROP` das tabelas de gastos e estoque e das flags legadas de `usuarios`. Faça `pg_dump` antes do primeiro deploy do código atual em cada ambiente.
- O código novo usa a tabela `usuario_restaurantes` (migration `016`) e o antigo usa o nome velho: publique API e web juntos.

## Verificado (23/10/2026)
`docker compose up --build` (Docker 27 no WSL): as três imagens constroem; a API aplica as 17 migrations e sobe como `healthy`; `GET /api/health` e `/api/health/ready` respondem 200; o web responde 200 e devolve `index.html` em rotas desconhecidas (fallback de SPA); `POST /api/login` com credencial inválida devolve 401; `create_admin.js` roda dentro do container; `docker stop` encerra a API com graciosidade em cerca de 1 s. Não testado: login e fluxo de boletos pela interface, e o deploy real no Easypanel.

## Pontos em aberto frente à documentação do Easypanel (builder Dockerfile)
- **`HEALTHCHECK` no Dockerfile:** a página do builder não fala de healthcheck, então não confirmei como o Easypanel o trata. No Docker funciona (containers `healthy`). Se a API for reiniciada em loop no primeiro deploy, suspeite de migrations que passam de ~2 min (40 s de `start-period` + 3 tentativas de 30 s) e aumente o `--start-period`.
- **Porta e domínio:** não constam nessa página; a porta do domínio é configurada na tela do serviço.
- **Imagens base sem versão fixa:** a documentação recomenda fixar versão ou digest das imagens base; hoje são `node:18-alpine` e `nginx:alpine`.

## Pendência
As imagens base são `node:18-alpine` (Node 18 saiu de suporte) e `nginx:alpine`; o IDE aponta vulnerabilidades nelas. Subir a base exige alinhar `@types/node`, o CI (`node-version: 18`) e testar o CRA, então ficou fora desta mudança.
