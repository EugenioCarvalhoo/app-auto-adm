# Testes do backend

Os testes de API e de migrations rodam contra um **Postgres real**, num banco dedicado terminado em `_test`. Não há banco falso.

## Forma rápida: `npm test`

```bash
cd backend
npm test                              # sobe o Postgres (Docker) se precisar e roda tudo
npm test -- test/boletos.test.js      # um arquivo
npm test -- -t "restaurante"          # por nome
npm run test:watch                    # reexecuta ao salvar
npm run test:coverage
```

O script `scripts/test.js` faz o trabalho de Docker por você:
1. Tenta conectar no banco de teste. Se já estiver no ar, segue direto.
2. Se não estiver e o host for local, **inicia o container** `pg-controle` (ou o **cria**, se não existir). No Windows usa o Docker de dentro do WSL (`wsl -d Ubuntu -- docker ...`); em Linux/macOS, o `docker` direto.
3. Cria o banco `controle_financeiro_test` se faltar.
4. Roda o Jest, repassando os argumentos.

Variáveis opcionais: `WSL_DISTRO` (distro WSL2 com Docker, padrão `Ubuntu`), `TEST_DB_CONTAINER`, `TEST_DB_IMAGE`, `TEST_DB_VOLUME`, `TEST_DB_AUTOSTART=0` (não mexe no Docker, só testa a conexão), além das `TEST_DB_*` de conexão.

`npm run test:jest` roda o Jest puro, sem tocar no Docker (é o que o CI usa, com o Postgres do próprio GitHub).

## MinIO de teste (S3 real)

Os testes do storage S3 (`storageMinio.test.js`) e o fluxo ponta a ponta de imagem (`storageFluxoMinio.test.js`: extrair -> criar boleto -> anexar -> baixar -> excluir -> `limpar-boletos`) rodam contra um **MinIO real**, análogo ao `pg-controle`:

- `npm test` sobe sozinho o container **`minio-controle`** (API `127.0.0.1:9100`, console `9101`; imagem `cgr.dev/chainguard/minio:latest`, a mesma do `docker-compose.yml`, porque o Docker Hub/quay do MinIO não servem mais; roda como root só por ser efêmero e de teste, pois o usuário `nonroot` da imagem não escreve em `/data`) e cria o bucket **privado** `boletos-test` (idempotente, via SDK, sem precisar do `mc`).
- Credenciais de teste: `minioteste` / `minioteste123`. Guarda de segurança: o bucket precisa terminar em `-test`.
- **Sem Docker/MinIO, esses testes são PULADOS com aviso** (`MinIO de teste fora do ar ... testes de MinIO serão PULADOS`), nunca falham. O `globalSetup.js` testa o MinIO e, se estiver no ar, garante o bucket (é o que basta no CI com `npm run test:jest`).
- Variáveis: `TEST_MINIO_ENDPOINT` (padrão `http://127.0.0.1:9100`), `TEST_MINIO_BUCKET`, `TEST_MINIO_ACCESS_KEY`, `TEST_MINIO_SECRET_KEY`, `TEST_MINIO_CONTAINER`, `TEST_MINIO_IMAGE`, `TEST_MINIO_AUTOSTART=0` (não mexe no Docker).
- Manual: `docker run -d --name minio-controle --user 0 -p 127.0.0.1:9100:9000 -p 127.0.0.1:9101:9001 -e MINIO_ROOT_USER=minioteste -e MINIO_ROOT_PASSWORD=minioteste123 cgr.dev/chainguard/minio:latest server /data --console-address :9001` (no Windows, via `wsl -d Ubuntu -- docker ...`). Se sumir no meio do trabalho: `docker start minio-controle`.

Os demais testes de imagem (rotas, permissões, teto diário) usam um **storage fake em memória** (`helpers/storageFake.js`, injetado com `definirStorage`), sem rede. O `limpar-boletos` (processo filho) usa o preload `helpers/preloadStorageFake.js`, que troca `criarStorageS3` por um storage em diretório temporário.

## Subir o Postgres de teste manualmente (opcional)

O padrão é o container local `pg-controle` (Postgres 15, porta `5433`, banco `controle_financeiro_test`):

```bash
docker run -d --name pg-controle \
  -p 127.0.0.1:5433:5432 \
  -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=controle_financeiro_dev \
  -v pg_controle_data:/var/lib/postgresql/data postgres:15
docker exec pg-controle psql -U postgres -c "CREATE DATABASE controle_financeiro_test"
```

Se o container já existe: `docker start pg-controle`.

> No Windows com o Docker dentro do WSL2, use `127.0.0.1` (não `localhost`, que resolve para IPv6 e é recusado). Já é o padrão.

Para outro Postgres, defina `TEST_DB_HOST`, `TEST_DB_PORT`, `TEST_DB_NAME`, `TEST_DB_USER` e `TEST_DB_PASSWORD`.

## Segurança

Os testes **apagam todos os dados** do banco e recriam o schema. Por isso `helpers/dbConfig.js` recusa qualquer banco cujo nome não termine em `_test`. Nunca aponte para homologação ou produção.

## Como rodar

```bash
cd backend
npx jest                          # Jest puro (exige o Postgres já no ar)
```

## Como funciona

1. `globalSetup.js` (uma vez por execução): derruba e recria o schema `public` do banco de teste e roda `database/migrate.js` — assim o próprio migrate e as migrations 001–015 são exercitados a cada execução.
2. `helpers/setup.js` — `usarBancoReal()` carrega o `server.js` real, abre o pool e, **antes de cada teste**, limpa as tabelas e grava o cenário padrão (`cenarioPadrao()`): restaurantes A=1, B=2 e inativo=3; usuários `admin`, `gerenteA`, `gerenteB`, `semModulo`, `semVinculo`, `financeiroLegado`; um boleto e uma meta por restaurante.
3. Os testes chamam a API com `supertest` e conferem a resposta **e** o banco (`env.rows(sql)`, `env.um(sql)`).
4. A suíte roda com um worker só (`maxWorkers: 1`), porque todos os arquivos compartilham o mesmo banco.

`health.test.js` e os testes de `lib/` não usam banco.

**Limitações:**
- Não rode duas execuções de `npm test` ao mesmo tempo no mesmo banco: o `globalSetup` recria o schema e as execuções disputam as tabelas (deadlocks).
- `upgrade.test.js` cria e apaga bancos próprios terminados em `_upgrade_test` (`controle_financeiro_upgrade_test`); o usuário do Postgres precisa poder criar bancos.
- No Windows, o container `pg-controle` pode ser derrubado pelo WSL ocioso. Se o Postgres sumir no meio do trabalho: `wsl -d Ubuntu -- docker start pg-controle`.

## Arquivos

| Arquivo | Cobre |
|---|---|
| `auth.test.js` | login, verify, JWT inválido/expirado/forjado, permissão lida do banco |
| `restaurantes.test.js` | admin vê todos, usuário só os vinculados, só admin gerencia |
| `boletos.test.js` | CRUD, validações, isolamento entre restaurantes (IDOR), semana e metas |
| `boletosExtrair.test.js` | `POST /boletos/extrair` (só leitura em memória, devolve `hash_sha256`, não grava anexo/objeto): 503, 413, 415, repetida, nota, 502, 429, IDOR |
| `boletosAnexo.test.js` | `POST /boletos/:id/anexo`: hash divergente 400, já tem imagem 409 (inclusive corrida/23505), boleto pago, 503 sem storage, 415/413, IDOR, soft delete, órfão apagado se o INSERT falha |
| `boletosLimiteDiario.test.js` | teto diário `EXTRAIR_LIMITE_DIARIO`: 429 `LIMITE_DIARIO` sem chamar o Gemini, por usuário e por dia, virada de dia, o que conta/não conta, concorrência |
| `boletosLinha.test.js` | linha digitável (duplicada global, corrida 23505), similaridade, `anexo_id` ignorado, soft delete em todas as consultas |
| `boletosPagamento.test.js` | pagar/desfazer, `GET /anexo` (storage fake), ocorrências do admin |
| `storage.test.js` | `lerConfigStorage` (https sempre; http só localhost/hostname interno), `definirStorage`/`getStorage`, validações do `criarStorageS3` sem rede |
| `storageMinio.test.js` | `criarStorageS3` contra MinIO real: salvar/ler/apagar, idempotência, traversal, bucket/credenciais erradas (pula sem MinIO) |
| `storageFluxoMinio.test.js` | ponta a ponta HTTP + MinIO real + `limpar-boletos --confirmar` (pula sem MinIO) |
| `podeMarcarPago.test.js` | flag `pode_marcar_pago` nas permissões, login e verify |
| `limparBoletos.test.js` | `scripts/limpar-boletos.js` (retenção, `--dry-run`, `--confirmar`, arquivos e órfãos, storage fora do ar, sem `STORAGE_*`); storage trocado por preload |
| `linhaDigitavel.test.js`, `fornecedor.test.js`, `gemini.test.js`, `rateLimit.test.js` | unitários de `lib/` (sem banco); `helpers/linhas.js` gera linhas válidas |
| `permissoes.test.js` | gestão de usuários só pelo admin, efeito imediato, transação |
| `migrations.test.js` | schema, regra da 015 com dados reais, idempotência do migrate |
| `upgrade.test.js` | banco isolado: estado 015 com dados, aplica 016+017+018 pelo `migrate.js`, confere vínculos, índices, boletos/metas e idempotência |
| `healthMigrations.test.js` | `/api/health/ready`: 200 com migrations em dia, 503 com pendentes, 503 com banco inacessível |
