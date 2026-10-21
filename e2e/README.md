# Testes E2E (Playwright)

Navegador real (Chromium) contra o front e o back de verdade, com Postgres real. Complementa o Jest do backend: aqui se testa o que o usuário vê e faz.

## Como rodar

```bash
cd e2e
npm install                 # primeira vez
npx playwright install chromium
npm test                    # headless
npm run test:headed         # vendo o navegador
npm run test:ui             # modo interativo do Playwright
npm run report              # abre o último relatório HTML
```

Na raiz: `npm run test:e2e`.

O que acontece sozinho:
1. `global-setup.js` garante o Postgres de teste (o mesmo container `pg-controle` da porta 5433; inicia se estiver parado), cria o banco `controle_financeiro_e2e_test`, recria o schema e roda o `migrate.js`.
2. O Playwright sobe a API (`:5100`) e o front (`:3100`, `react-scripts start` com `REACT_APP_API_URL`) apontados para esse banco. Se já estiverem no ar (fora do CI), reaproveita.
3. Antes de **cada teste** o banco é semeado do zero (`support/db.js`), reaproveitando o cenário do Jest (`backend/test/helpers/setup.js`): `admin`, `gerenteA`, `gerenteB`, `semModulo`, `semVinculo`, `financeiroLegado` e `multi` (dois restaurantes). Senha de todos: `senha123`.

Portas e banco não colidem com `npm run dev` (5000/3000) nem com o Jest. O banco E2E precisa terminar em `_test` (guarda de segurança; o semeador apaga tudo).

Variáveis: `E2E_DB_NAME`, `E2E_API_PORT`, `E2E_WEB_PORT`, `TEST_DB_HOST/PORT/USER/PASSWORD`, `WSL_DISTRO`, `TEST_DB_CONTAINER`.

## Suítes

| Arquivo | Cobre |
|---|---|
| `auth.spec.js` | login inválido/válido, sessão após recarregar, sair, token inválido, usuário sem módulo |
| `acesso.spec.js` | abas por perfil, escolha e troca de restaurante, sem vínculo, `modulo_financeiro` legado, vínculo removido |
| `boletos.spec.js` | cadastrar, editar, excluir (e recusar), validações, dashboard semanal e troca de restaurante |
| `metas.spec.js` | meta pela aba e pelo card da semana, saldo, exclusão |
| `admin.spec.js` | Início, cadastro de restaurante, criação de usuário (e login dele), restaurante obrigatório |
| `api-isolamento.spec.js` | 401/403 direto na API: leitura, edição, exclusão e criação em restaurante alheio, rotas de admin |

## Dicas
- Seletores usam rótulos e classes atuais da tela; se a tela mudar, ajuste `support/fixtures.js` (helpers `entrar`, `lancar`, `abrirCadastro`...).
- Falhas guardam screenshot e trace em `test-results/` (`npx playwright show-trace <trace.zip>`).
