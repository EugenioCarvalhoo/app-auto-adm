# Plano de ação — enxugar o projeto para Boletos + Auth/Restaurantes

> **Plano concluído** (fases 0–5: migrations 015–017, backend e frontend em TypeScript). Este arquivo é só histórico; o estado atual e as decisões estão em [HISTORICO-ETAPAS.md](./HISTORICO-ETAPAS.md).

Escopo a manter: cadastro de boletos/notas e dashboard semanal (front e back); autenticação, autorização e separação por restaurante.

## 1. Diagnóstico

`backend/server.js` tem 2.877 linhas, e cerca de 60% delas são estoque e gastos.

| Área | Onde | Veredito |
|---|---|---|
| Boletos/notas, resumo semanal, metas | `server.js` L1972–2345, `lib/boletosSemana.js`, `BoletosModulo.tsx/css`, `lib/boletosSemana.ts`, migration 014 | **MANTER** |
| Login, verify, JWT | `loginHandler`, `/api/verify`, `middleware/auth.js`, `Login.js` | **MANTER** |
| Restaurantes | `/api/restaurantes*` (L537–650), `CadastroRestaurantes.js`, migrations 003/005 | **MANTER** (só o CRUD de restaurante) |
| Permissões de usuário | `/api/admin/usuarios-permissoes*`, `AdminPermissoesUsuarios.tsx`, migrations 002/007/013 | **MANTER e simplificar** |
| Gastos | `/api/gastos*` (L650–870), `GridEditavel.js/css` (1.616 linhas), migrations 001/003-retroativo/004 | **DESCARTAR** |
| Relatórios | `Relatorios.js/css` | **DESCARTAR** |
| Estoque | `/api/estoque*` (L873–1970, ~1.100 linhas), `components/estoque/` (15 arquivos), `Estoque.css` (2.262 linhas), `lib/estoqueQuantidade.js`, `estoqueMovimentarApi.ts`, migrations 006/008–012, `MODULO_ESTOQUE.md`, `Manual_modulo_estoque_cliente.html` | **DESCARTAR** |
| Usuários "estoque" | `/api/admin/usuarios-estoque*`, `AdminUsuariosEstoque.tsx/css` | **DESCARTAR** (o componente nem é importado em lugar nenhum) |
| `AdminDashboard.tsx` | Dashboard admin que mistura gastos + estoque + boletos | **REESCREVER** só com boletos (ou remover e abrir direto em boletos) |
| Docs de deploy | 20+ arquivos `*_EASYPANEL.md`, `GUIA_DEPLOY_EASYPANEL.html`, `SOLUCAO_DEFINITIVA_SIGTERM.md` etc. (~100 KB na raiz) | **ARQUIVAR** em `docs/deploy/` e manter 1 só (`DEPLOY_EASYPANEL.md`) |
| Scripts soltos | `get-ip.js`, `limpar-cookies.html`, `ACESSO-CELULAR.md`, `setup.md`, `HOMOLOGACAO.md`, `VARIAVEIS_ENV_EXEMPLO.txt`, `backend/env.example` (duplicado de `.env.example`) | **DESCARTAR/consolidar** |
| Testes | `estoqueQuantidade.test.js` | **DESCARTAR**; manter `boletosSemana` e `health` |

## 2. Problemas encontrados que afetam o escopo (corrigir na Fase 1)

1. **Isolamento por restaurante furado para quem tem `modulo_financeiro`.** `assertBoletosAcessoRestaurante` libera qualquer restaurante para `is_admin || modulo_financeiro`. Ao remover o módulo financeiro, isso deve virar: **só admin vê tudo; os demais só veem restaurantes vinculados**.
2. **Nome enganoso:** o vínculo usuário↔restaurante está em `usuario_restaurante_estoque`. Renomear para `usuario_restaurantes`.
3. **`JWT_SECRET` com valor padrão** em `middleware/auth.js`. Em produção, deve falhar a inicialização se não estiver definido.
4. **Rotas de restaurante (POST/PUT/DELETE)** usam `requireFinanceiroAccess`; devem passar a `requireAdmin`.
5. **Frontend** tem regra duplicada de permissões (`userPermissoes.js` e `App.js`) cheia de casos legados (`somente_estoque`).
6. **Logs de login** imprimem o username e passos de autenticação; reduzir.
7. **Limite `express.json 50mb`**: só era necessário para foto de estoque; baixar para 1 MB.
8. **Código não testado:** não há teste de autorização (isolamento por restaurante). Adicionar na Fase 1.

## 3. Fases

Cada fase termina com `cd backend && npm test`, `cd frontend && npm run build` e um commit próprio. Dá para reverter fase por fase.

### Fase 0 — Preparação (15 min)
- Commit ou descarte da alteração pendente em `frontend/package.json` (o `cross-env` foi removido do `start`; ele quebra a `HOST=0.0.0.0` no Windows, decida qual manter).
- Criar branch `limpeza-escopo` e **backup do banco** (`pg_dump`) antes de qualquer migration destrutiva.
- Confirmar com o cliente que gastos, relatórios e estoque podem sair. Verifique se há dados em produção que precisam ser exportados.

### Fase 1 — Testes de segurança antes de mexer (0,5 dia)
- Escrever testes Supertest (com `pg` mockado, como em `health.test.js`) cobrindo: login inválido, rota sem token (401), usuário sem `modulo_boletos` (403), usuário vinculado ao restaurante A tentando ler/editar/apagar boleto do restaurante B (403), admin acessa tudo.
- Isso é a rede de segurança para a limpeza.

### Fase 2 — Remover o front legado (0,5 dia)
- Apagar: `GridEditavel.*`, `Relatorios.*`, `components/estoque/`, `Estoque.css`, `AdminUsuariosEstoque.*`, `lib/estoqueMovimentarApi.ts`.
- `App.js`: tirar estados e abas de gastos/relatórios/estoque; ficam login, seleção de restaurante, boletos, restaurantes (admin) e permissões (admin).
- `AdminDashboard.tsx`: reduzir a boletos ou remover.
- Simplificar `userPermissoes.js` para `{ admin, boletos }`.
- Remover `@testing-library` se não for usado; manter `axios`, `react`, `typescript`.

### Fase 3 — Remover o back legado (0,5 dia)
- Apagar de `server.js`: rotas `/api/gastos*`, `/api/estoque*`, `/api/admin/usuarios-estoque*`; helpers de estoque (`inserirMovimentoEstoque`, `parseTipoMovimento`, `periodoSemanaContendo` etc.), `requireModuloEstoque*`, `requireFinanceiroAccess`.
- Apagar `lib/estoqueQuantidade.js` e seu teste.
- Dividir o que sobrar em módulos: `routes/auth.js`, `routes/restaurantes.js`, `routes/boletos.js`, `routes/admin.js`, `middleware/permissoes.js`, `db.js`. (`server.js` deve ficar com ~100 linhas.)

### Fase 4 — Banco de dados (0,5 dia, com backup)
Nova migration `015_limpeza_escopo.sql`:
- `ALTER TABLE usuario_restaurante_estoque RENAME TO usuario_restaurantes` (e índices).
- Atualizar `modulo_boletos = true` para quem tinha `modulo_financeiro` ou `modulo_estoque*` e deve manter acesso.
- **Só depois da validação do cliente:** `DROP TABLE` de `gastos`, `estoque_*` e `DROP COLUMN` das flags `modulo_financeiro`, `modulo_estoque`, `modulo_estoque_simplificado`, `somente_estoque`.
- Não editar migrations antigas já aplicadas; criar só a nova.

### Fase 5 — Ajustes de segurança (0,5 dia)
- Os itens 1, 3, 4, 6 e 7 do diagnóstico.
- Considerar `helmet` e rate limit em `/api/login`.

### Fase 6 — Docs e deploy (0,25 dia)
- Mover os `*_EASYPANEL.md` para `docs/deploy/`, manter um só guia.
- Atualizar `README.md`, `TESTING.md` e `setup.md` (ou remover o `setup.md`).
- Validar o build Docker de `backend/` e `frontend/` em homologação.

### Fase 7 — E2E opcional (0,5 dia)
- Playwright com Postgres de teste dedicado (não em memória) cobrindo: login, trocar de restaurante, cadastrar boleto, ver total semanal, tentativa de acesso a outro restaurante.

## 4. Resultado esperado
- `server.js`: de 2.877 para ~100 linhas (mais módulos pequenos).
- Frontend: sai cerca de 7.000 linhas de JS/TSX/CSS (`Estoque.css`, `GridEditavel`, `estoque/`, etc.).
- Menos superfície de ataque e menos contexto para o Claude ler a cada sessão.

## 5. Decisões que dependem de você
1. Os dados de gastos e estoque em produção podem ser **apagados** ou precisam ser exportados antes?
2. Usuários que hoje só têm `modulo_financeiro` devem ganhar `modulo_boletos` e ficar presos aos restaurantes vinculados?
3. O dashboard admin (`AdminDashboard`) deve continuar, só com boletos, ou a tela inicial pode ser direto a de boletos?
