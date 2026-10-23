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
| `GEMINI_API_KEY` | não | Chave da API do Gemini para ler boleto/nota por imagem. Sem ela o app sobe e `POST /api/boletos/extrair` responde 503 "Leitura por IA não configurada". Segredo: só nas variáveis do serviço, nunca em arquivo versionado. |
| `GEMINI_MODEL` | não | Padrão `gemini-2.5-flash-lite`. |
| `GEMINI_BASE_URL` | não | URL base da API do Gemini (padrão `https://generativelanguage.googleapis.com/v1beta/models`). Só `https`; `http` apenas para `localhost`/`127.0.0.1` (mock). Inválida: a leitura por IA responde 503 e o app continua de pé. |
| `GEMINI_TIMEOUT_MS` | não | Timeout de cada chamada ao Gemini em ms (inteiro positivo, padrão `20000`). |
| `STORAGE_ENDPOINT` | para imagens | URL do serviço S3-compatível (MinIO). `https` sempre; `http` só para `localhost`/`127.0.0.1`/`::1` e hostnames internos (sem ponto, ex.: `http://minio:9000`, ou terminados em `.internal`/`.local`/`.svc`). Fora disso é rejeitado e as imagens respondem 503. |
| `STORAGE_BUCKET` | para imagens | Nome do bucket (precisa existir e ser **privado**; a API não o cria). |
| `STORAGE_ACCESS_KEY`, `STORAGE_SECRET_KEY` | para imagens | Credenciais de um usuário do MinIO com acesso **só a esse bucket** (ver abaixo). Segredos: só nas variáveis do serviço. |
| `STORAGE_REGION` | não | Padrão `us-east-1` (o MinIO aceita qualquer valor). |
| `STORAGE_FORCE_PATH_STYLE` | não | Padrão `true` (necessário na maioria dos MinIO). `false` para virtual-host (ex.: AWS S3). |
| `EXTRAIR_LIMITE_DIARIO` | não | Teto de leituras por IA por usuário por dia (America/Sao_Paulo), padrão 30. Fica no banco (tabela `boletos_extracoes_uso`, migration 019); ao estourar, 429 "Limite diário de leituras por IA atingido". |
| `BOLETOS_RETENCAO_DIAS` | não | Dias que um boleto excluído (soft delete) e as imagens ficam retidos antes da limpeza definitiva. **Sem ela (ou inválida), a limpeza não apaga nada.** |
| `EXTRAIR_RATE_LIMIT_MAX` | não | Leituras por imagem por usuário por minuto (padrão 10). |

### Imagens dos boletos (MinIO / S3)
- **Armazenamento:** serviço externo S3-compatível, **MinIO**, acessado só por `STORAGE_*`. A API não tem volume nem diretório de uploads. Sem `STORAGE_*` completo e válido a API sobe normalmente e as rotas de anexo respondem 503 "Armazenamento de imagens não configurado".
- **Fluxo:** `POST /api/boletos/extrair` lê a imagem **em memória** e não grava nada. A imagem só vai ao bucket quando o usuário **confirma** o boleto (anexo enviado depois de salvar). Imagens só saem por `GET /api/boletos/:id/anexo` (com checagem de acesso ao restaurante); o bucket nunca é público nem usa URL pré-assinada.
- **CORS:** a API expõe os headers `Retry-After` e `Content-Disposition` ao navegador (front e API em hosts diferentes).
- **MinIO no Easypanel (serviço separado, ou externo):**
  1. Crie um serviço MinIO com volume persistente em `/data` e **troque as credenciais root**. O console fica na porta 9001; não o exponha publicamente sem necessidade.
  2. Crie o bucket **privado** (sem política anônima), por exemplo `boletos`, com o `mc`:
     ```bash
     mc alias set prod https://minio.exemplo.com ROOT_USER ROOT_PASSWORD
     mc mb --ignore-existing prod/boletos
     mc anonymous set none prod/boletos
     ```
  3. Crie um usuário de **menor privilégio** só para o bucket (não use o root na API). Salve a policy abaixo em `boletos-rw.json`:
     ```json
     {
       "Version": "2012-10-17",
       "Statement": [
         { "Effect": "Allow", "Action": ["s3:ListBucket"], "Resource": ["arn:aws:s3:::boletos"] },
         { "Effect": "Allow", "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"], "Resource": ["arn:aws:s3:::boletos/*"] }
       ]
     }
     ```
     ```bash
     mc admin policy create prod boletos-rw boletos-rw.json
     mc admin user add prod api-boletos SENHA_LONGA_E_ALEATORIA
     mc admin policy attach prod boletos-rw --user api-boletos
     ```
     (versões antigas do `mc` usam `mc admin policy add` / `mc admin policy set`). Use `api-boletos` e a senha como `STORAGE_ACCESS_KEY`/`STORAGE_SECRET_KEY`.
  4. Na API: `STORAGE_ENDPOINT` (URL https pública do MinIO, ou `http://<nome-interno>:9000` se estiver na mesma rede do Easypanel), `STORAGE_BUCKET=boletos` e as chaves.
- **Imagem do MinIO:** o `minio/minio` e o `minio/mc` não existem mais no Docker Hub (conferido em 23/10/2026: o repositório não é encontrado) e o `quay.io/minio` exige login. O `docker-compose.yml` usa `cgr.dev/chainguard/minio:latest` (servidor + `mc`; troque pela variável `MINIO_IMAGE`). No Easypanel use o template/imagem de MinIO que o painel oferecer, ou um S3 gerenciado (Cloudflare R2, AWS S3, Backblaze B2).
- Limite de **5 MB** por imagem (API valida; acima disso responde 413). O nginx do `frontend/nginx.conf` só serve o estático e **não faz proxy** da API (front e API em hosts diferentes), então não há `client_max_body_size` a ajustar nele. Se você colocar um proxy/CDN na frente da API, libere pelo menos 6 MB de corpo.
- **Backup:** o banco guarda só a chave do objeto, então faça backup do **bucket junto do `pg_dump`**, na mesma janela. Opções: `mc mirror prod/boletos ./backup-boletos` (cópia dos objetos), backup do volume de dados do MinIO (`docker run --rm -v <volume_minio>:/data -v "$PWD":/bkp alpine tar czf /bkp/minio.tgz -C /data .`, de preferência com o MinIO parado) ou o versionamento/backup do provedor S3.
- **Limpeza definitiva** (apaga boletos excluídos há mais de `BOLETOS_RETENCAO_DIAS`, anexos órfãos com os objetos do bucket e `boletos_ocorrencias` mais antigas que o mesmo prazo). Ordem: apaga a linha no banco e depois o objeto; se a exclusão do objeto falhar, só loga um aviso. **Para apagar os objetos o comando precisa de `STORAGE_*`** no ambiente em que roda; sem eles, limpa só o banco (os objetos ficam órfãos no bucket). `--dry-run` e `--confirmar` juntos dão erro de uso e nada é apagado. Rode primeiro a simulação, depois confirme:

```bash
docker exec <container-api> npm run limpar-boletos -- --dry-run
docker exec <container-api> npm run limpar-boletos -- --confirmar
```

  No Easypanel use o terminal do serviço da API (mesmos comandos, sem `docker exec`). Para agendar, use cron do host chamando `docker exec ... --confirmar` ou um Cron Job do Easypanel com `npm run limpar-boletos -- --confirmar` na imagem da API (com as mesmas variáveis do banco e `STORAGE_*`). Sem `BOLETOS_RETENCAO_DIAS` nada é apagado. Faça `pg_dump` antes da primeira execução com `--confirmar`.
- **LGPD:** as imagens contêm dados de terceiros (fornecedores, CNPJ, valores) e são enviadas ao Google para leitura. Use um plano **pago** da API do Gemini (o gratuito pode usar o conteúdo para melhorar produtos) e informe isso a quem for responsável pelos dados.

### URL da API no front (`REACT_APP_API_URL`)
O CRA embute `REACT_APP_*` no JavaScript **na hora do build**. Variável de ambiente do container em runtime não muda nada.
- No Easypanel, o Buildx passa as variáveis do serviço como build args, e o Dockerfile só recebe as que declara com `ARG` (o `frontend/Dockerfile` declara `REACT_APP_API_URL`). Então crie `REACT_APP_API_URL` nas **variáveis de ambiente do serviço web**, com a URL pública da API **terminando em `/api`**, ex.: `https://api.exemplo.com/api`. Mudou a URL, refaça o deploy com **Force Rebuild** (o cache do Docker pode reaproveitar o bundle antigo).
- Build args não são mecanismo de segredo: só ponha aqui a URL pública, nunca senha ou token.
- Sem ela, `frontend/src/config.ts` deduz o host a partir do hostname (padrão `financialmanagement` para `financialmanagementapp` em `easypanel.host`); fora desse padrão a API não é encontrada.

## Rodar tudo localmente com Docker

Valida as imagens de produção com um Postgres e um MinIO descartáveis:

```bash
export JWT_SECRET=$(openssl rand -hex 32)      # PowerShell: $env:JWT_SECRET = -join ((1..32) | % { '{0:x2}' -f (Get-Random -Max 256) })
docker compose up --build
```

- Front: `http://localhost:8080` (mude com `WEB_PORT`), API: `http://localhost:5000/api/health`.
- MinIO local: serviço `minio` (volume `minio_data`, onde as imagens ficam) e `minio-init`, que cria o bucket privado `${STORAGE_BUCKET:-boletos}` (idempotente) e termina; a `api` só sobe depois. Console em `http://localhost:9001` e S3 em `:9000`, publicados só em `127.0.0.1`. As credenciais padrão (`minioadmin`/`minioadmin`) são **só para uso local**; defina `MINIO_ROOT_USER`/`MINIO_ROOT_PASSWORD` se a máquina for compartilhada. Aqui a API usa o usuário root por simplicidade; em produção use o usuário restrito.
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

## Ordem segura de deploy e diagnóstico (`/api/health/ready`)

- **Ordem:** (1) `pg_dump` do banco; (2) publique a API nova, cujo `CMD` aplica as migrations pendentes antes de iniciar; (3) publique o web; (4) confira `GET /api/health/ready`.
- **`GET /api/health/ready`** (também `/health`): 200 `{status:'ok', check:'ready', database:'connected', migrations:'ok', timestamp}`; 503 com `migrations:'pending'`, `pendentes:[...]` e `error:'Migrations pendentes: ...'` quando falta alguma; 503 com `database:'disconnected'` se o banco estiver inacessível.
- **O `HEALTHCHECK` do Docker continua em `/api/health` (liveness) de propósito:** ele não consulta o banco. Se apontasse para o `ready`, migrations pendentes ou banco fora do ar fariam o Easypanel reiniciar a API em loop. Use o `ready` manualmente, ou em monitoramento externo.
- **No boot** a API loga um erro destacado com as migrations pendentes e a instrução `node database/migrate.js (faça pg_dump antes)`. Ela **não** encerra o processo (evita loop de reinício) e **não** aplica migrations sozinha. Como o `CMD` já roda o `migrate.js`, essa checagem vale para execução local e para `RUN_MIGRATIONS=0`.
- **Se aparecer "Banco desatualizado: migrations pendentes"** (503 em admin, restaurantes, `/api/verify` ou boletos; antes era um 500 genérico "relation ... does not exist"): consulte `/api/health/ready` para ver as pendentes, faça `pg_dump` e rode `node database/migrate.js` no terminal da API (ou redeploy com `RUN_MIGRATIONS` ligado).

### Atenção: homologação e produção ainda não têm 016 e 017
O código antigo ainda roda nos dois ambientes. O **primeiro deploy do código novo aplica a 016 (rename para `usuario_restaurantes`) e a 017 (`DROP` de gastos/estoque e flags legadas)**. Elas ainda **NÃO** foram aplicadas lá. Faça o `pg_dump` antes e publique API e web juntos.

## Problemas comuns
- **503 "Leitura por IA não configurada"** em `POST /api/boletos/extrair`: falta `GEMINI_API_KEY` no serviço da API (o resto do app funciona; o cadastro manual continua). Defina a variável e reinicie.
- **413** ao enviar imagem: acima de 5 MB. Reduza a foto; se houver proxy na frente da API, libere o corpo.
- **503 "Armazenamento de imagens não configurado"** em anexo/imagem: falta alguma de `STORAGE_ENDPOINT`, `STORAGE_BUCKET`, `STORAGE_ACCESS_KEY`, `STORAGE_SECRET_KEY`, ou o valor é inválido. Veja o log do boot (`[storage] ...`).
- **Endpoint `http://` rejeitado** (log "STORAGE_ENDPOINT deve ser https"): `http` só vale para `localhost`/`127.0.0.1`/`::1` e hostnames internos (sem ponto, `.internal`, `.local`, `.svc`). Um MinIO em domínio público precisa de `https`.
- **Erro ao enviar/ler imagem com a configuração completa:** bucket inexistente (a API não o cria; crie-o privado) ou credenciais/policy erradas (a policy precisa de `ListBucket` no bucket e `GetObject`/`PutObject`/`DeleteObject` nos objetos). Teste com `mc ls prod/boletos` usando as mesmas chaves.
- **429 "Limite diário de leituras por IA atingido":** teto por usuário (`EXTRAIR_LIMITE_DIARIO`, padrão 30/dia).
- **Migrations 018 e 019** são aditivas (018: colunas, tabelas e índice único parcial da linha digitável; 019: `boletos_extracoes_uso`), sem `DROP`. Sobre a 018: Se já existirem boletos com a mesma linha digitável, o índice único pode falhar: confira antes. Mesmo assim, `pg_dump` antes.

## Verificado (23/10/2026)
`docker compose up --build` (Docker 27 no WSL): as três imagens constroem; a API aplica as 17 migrations e sobe como `healthy`; `GET /api/health` e `/api/health/ready` respondem 200; o web responde 200 e devolve `index.html` em rotas desconhecidas (fallback de SPA); `POST /api/login` com credencial inválida devolve 401; `create_admin.js` roda dentro do container; `docker stop` encerra a API com graciosidade em cerca de 1 s. Não testado: login e fluxo de boletos pela interface, e o deploy real no Easypanel.

Feature de boleto por imagem (23/10/2026, Docker 27 no WSL): `docker compose config` válido; `minio` fica `healthy` e `minio-init` cria o bucket `boletos` privado e termina com código 0 (repetível); `docker build ./backend` conclui e `@aws-sdk/client-s3` carrega no Node 18.20.8 da imagem (o `npm ci` emite `EBADENGINE` de duas dependências transitivas que pedem Node 20, `@aws-sdk/util-locate-window` e `brace-expansion`; são só avisos). **Não** validado ainda: a stack completa com a `api` falando com o MinIO (upload/download de anexo) e `limpar-boletos` dentro da imagem. Rode `docker compose up --build` e `docker compose exec api npm run limpar-boletos -- --dry-run` antes de publicar.

**Imagens existentes:** a feature ainda não foi publicada (`main` e `homologacao` não têm a migration 018 nem o código de anexos), então não há imagens em volume local a migrar. Se algum ambiente de teste tiver imagens num antigo `/data/uploads`, copie-as manualmente para o bucket (`mc cp --recursive`, mantendo a chave gravada em `boletos_anexos.storage_chave`).

## Pontos em aberto frente à documentação do Easypanel (builder Dockerfile)
- **`HEALTHCHECK` no Dockerfile:** a página do builder não fala de healthcheck, então não confirmei como o Easypanel o trata. No Docker funciona (containers `healthy`). Se a API for reiniciada em loop no primeiro deploy, suspeite de migrations que passam de ~2 min (40 s de `start-period` + 3 tentativas de 30 s) e aumente o `--start-period`.
- **Porta e domínio:** não constam nessa página; a porta do domínio é configurada na tela do serviço.
- **Imagens base sem versão fixa:** a documentação recomenda fixar versão ou digest das imagens base; hoje são `node:18-alpine` e `nginx:alpine`.

## Pendência
As imagens base são `node:18-alpine` (Node 18 saiu de suporte) e `nginx:alpine`; o IDE aponta vulnerabilidades nelas. Subir a base exige alinhar `@types/node`, o CI (`node-version: 18`) e testar o CRA, então ficou fora desta mudança.
