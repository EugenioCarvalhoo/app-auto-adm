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
2. `helpers/setup.js` — `usarBancoReal()` carrega o app real (`server.ts`, compat sobre `src/`), abre o pool e, **antes de cada teste**, limpa as tabelas e grava o cenário padrão (`cenarioPadrao()`): restaurantes A=1, B=2 e inativo=3; usuários `admin`, `gerenteA`, `gerenteB`, `semModulo`, `semVinculo`, `financeiroLegado`; um boleto e uma meta por restaurante.
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
| `permissoes.test.js` | gestão de usuários só pelo admin, efeito imediato, transação |
| `migrations.test.js` | schema, regra da 015 com dados reais, idempotência do migrate |
| `upgrade.test.js` | banco isolado: estado 015 com dados, aplica 016+017 pelo `migrate.js`, confere vínculos, índices, boletos/metas e idempotência |
| `healthMigrations.test.js` | `/api/health/ready`: 200 com migrations em dia, 503 com pendentes, 503 com banco inacessível |

## Testes de contrato (`contrato*.test.js`)

Rede de segurança do contrato HTTP da API (status, corpo exato, mensagens de erro, CORS, 401/403/404/400/409/503). Devem passar sem alteração em qualquer implementação do backend.

- O app é carregado só por `helpers/app.js` (`criarApp()` devolve `{ app, pool, fechar }`). Ao trocar o framework, altere apenas esse helper; ele precisa devolver o **mesmo pool** que a API usa, porque alguns testes espionam `pool.query`/`pool.connect`.
- `it.failing(...)` marca bug de produção conhecido: passa enquanto o bug existe e falha quando for corrigido (aí troque por `it`).
- `contratoErrosBanco.test.js` renomeia tabelas/colunas de verdade (e restaura em `finally`): não rode duas execuções do Jest ao mesmo tempo contra o mesmo banco de teste.
