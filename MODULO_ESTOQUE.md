# Módulo de Estoque (multi-restaurante)

## Visão geral

- **Categorias** e **produtos** por restaurante.
- **Admin** (`usuarios.is_admin = true`): cadastra categorias e produtos (nome, unidade/descrição, categoria, quantidade inicial), edita tudo e exclui.
- **Demais usuários**: só alteram **quantidade** (API valida).
- **Quantidade**: sempre **inteiro ≥ 0** (sem decimais). A API rejeita valores fracionários ou não numéricos.
- **Movimentação**: cada alteração de quantidade gera registro em `estoque_movimentos` (`quantidade_antes`, `quantidade_depois`, `diferenca`). `diferenca > 0` = entrada, `< 0` = saída (ex.: 10→8 ⇒ −2 saídas). Cadastro com qtd inicial > 0 gera entrada a partir de 0.
- **Lançamento operacional**: a tela principal agora lança **entrada/saída explícita** por quantidade (não apenas ajuste de saldo).
- **Correção de erro**: cada lançamento pode ser **estornado** (gera um movimento inverso com rastreabilidade).
- **Auditoria**: grava **operador**, **data/hora**, tipo (`entrada`, `saida`, `ajuste`, `estorno`) e observação opcional.
- **Relatório**: `GET /api/estoque/movimentos/resumo` — totais e por produto no período (padrão: semana corrente, segunda–domingo). `GET /api/estoque/movimentos` — últimos lançamentos (auditoria).
- Migração **`008_estoque_movimentos.sql`**: tabela `estoque_movimentos`.
- Migração **`009_estoque_movimentos_operacao_estorno.sql`**: campos de tipo/quantidade/observação e estorno.
- Migração **`010_estoque_movimentos_trigger_defaults.sql`**: trigger que preenche `tipo`/`quantidade` em INSERTs sem essas colunas (evita erro 500 se o deploy do backend ficar atrás da migração 009).
- **Perfil estoque** (`usuarios.somente_estoque = true`): vê **apenas** o módulo Estoque no app; rotas `/api/gastos*` retornam **403**; **POST/PUT/DELETE** em `/api/restaurantes` também retornam **403** (apenas **GET** para escolher o restaurante no seletor).
- **Restaurantes por usuário de estoque**: a tabela `usuario_restaurante_estoque` define em quais restaurantes cada usuário `somente_estoque` pode **ver e lançar** estoque. Fora dessa lista, **GET** `/api/restaurantes`, **GET** `/api/estoque/agrupado` e **PUT** de quantidade em produto retornam **403**.
- **Administrador**: no app, aba **Usuários estoque** — criar/editar/excluir usuários `somente_estoque` e marcar os restaurantes de cada um.

## Migração SQL

Execute no PostgreSQL (ou rode `node backend/database/migrate.js` após incluir as migrações na lista):

Arquivos:

- `006_estoque_modulo.sql` — coluna `somente_estoque`, tabelas de estoque.
- `007_usuario_restaurante_estoque.sql` — vínculo usuário ↔ restaurante para perfil estoque (e backfill: quem já era `somente_estoque` ganha acesso a todos os restaurantes ativos).
- `008_estoque_movimentos.sql` — histórico base de movimentos.
- `009_estoque_movimentos_operacao_estorno.sql` — operação explícita e estorno.

Conteúdo principal (006):

- `ALTER TABLE usuarios ADD COLUMN somente_estoque BOOLEAN DEFAULT false`
- Tabelas `estoque_categorias` e `estoque_produtos`

Conteúdo principal (007):

- Tabela `usuario_restaurante_estoque (usuario_id, restaurante_id)`

## Marcar usuário como “somente estoque”

```sql
-- Substitua 'usuario_estoque' pelo login desejado
UPDATE usuarios
SET somente_estoque = true
WHERE username = 'usuario_estoque';
```

O usuário precisa **fazer login de novo** para o token JWT trazer o novo perfil.

## Marcar usuário como admin (cadastro de itens)

```sql
UPDATE usuarios
SET is_admin = true, somente_estoque = false
WHERE username = 'admin';
```

## API (todas exigem `Authorization: Bearer <token>`)

| Método | Rota | Quem |
|--------|------|------|
| GET | `/api/estoque/agrupado?restaurante_id=` | Autenticado |
| POST | `/api/estoque/categorias` | Admin |
| PUT | `/api/estoque/categorias/:id` | Admin |
| DELETE | `/api/estoque/categorias/:id` | Admin |
| POST | `/api/estoque/produtos` | Admin |
| PUT | `/api/estoque/produtos/:id` | Admin: corpo completo; demais: só `{ "quantidade": n }` |
| DELETE | `/api/estoque/produtos/:id` | Admin |

### Admin — usuários de estoque (somente `is_admin`)

| Método | Rota | Corpo / notas |
|--------|------|----------------|
| GET | `/api/admin/usuarios-estoque` | Lista usuários com `somente_estoque` e `restaurante_ids` |
| POST | `/api/admin/usuarios-estoque` | `username`, `password`, `nome`, `restaurante_ids` (array, ≥1) |
| PUT | `/api/admin/usuarios-estoque/:id` | `nome`, `password` (opcional), `restaurante_ids` (substitui vínculos) |
| DELETE | `/api/admin/usuarios-estoque/:id` | Remove o usuário |

Login e `/api/verify` passam a incluir `restaurante_ids` no objeto `user` quando `somente_estoque` é true.

## Frontend (TypeScript incremental)

- Novo módulo em **`src/components/Estoque.tsx`** + **`Estoque.css`** (layout mobile-first).
- Entrada do app: **`src/index.tsx`** (TypeScript).
- **`App.js`** permanece em JavaScript; importa o componente TS normalmente.
- Para migrar o restante do projeto para TS, renomeie arquivos `.js` → `.tsx` aos poucos e corrija tipos (`strict` ativo no `tsconfig.json`).

## Instalação local (frontend)

Na pasta `frontend`:

```bash
npm install
npm start
```

Certifique-se de que a migração `006` foi aplicada no banco antes de usar o estoque.
