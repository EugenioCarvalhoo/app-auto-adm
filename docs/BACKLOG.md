# Backlog de melhorias

Atualizado em 23/10/2026, após a migração do backend para NestJS e a limpeza do projeto. Escopo do produto: boletos/notas com dashboard semanal e metas, e autenticação com separação por restaurante (`CLAUDE.md`).

**Legenda.** Prioridade: P0 bloqueia entrega, P1 segurança/confiabilidade, P2 produto, P3 dívida técnica. Dono: agente da camada (`backend-api`, `frontend-ui`, `database-migrations`, `qa-tests`, `security-reviewer`, `devops-docs`) ou **Você** (ação fora do repositório). Itens que mudam o contrato da API (sempre para melhor) estão marcados com **[contrato]** e devem ir em branch própria; os testes `it.failing` correspondentes viram `it`.

## P0 — Bloqueia entrega

| ID | Item | Dono | Pronto quando |
|---|---|---|---|
| B-01 | Aplicar migrations 016 e 017 em homologação e produção (a 017 é destrutiva: `pg_dump` antes) junto com o deploy do código novo | Você + database-migrations | `GET /api/health/ready` responde `migrations: 'ok'` nos dois ambientes |
| B-02 | Esvaziar o "Comando de Início" da API no Easypanel (o `dist/server.js` antigo não existe mais) | Você | Container sobe com o `CMD` do Dockerfile e fica `healthy` |
| B-03 | Rodar o pipeline de CI no GitHub pela primeira vez (só foi validado localmente) | devops-docs + Você | Jobs backend, frontend, e2e e docker verdes no GitHub |
| B-04 | Criar branch `homologacao` alinhada, secrets `EASYPANEL_*_WEBHOOK` e ambientes `homologacao`/`producao` (aprovação manual na produção); desligar deploy automático por push | Você | Merge em `homologacao` dispara deploy só após o CI |
| B-05 | Validar o build do front (`CI=true react-scripts build`) e o `docker compose up --build` com o `web` (porta 8080 estava ocupada; use `WEB_PORT=8081`) | frontend-ui + devops-docs | Fluxo de boletos funciona pela interface em containers |

## P1 — Segurança e confiabilidade

Origem: auditoria do `security-reviewer` e bugs do `qa-tests`. Branch sugerida: `fix/seguranca-backend`.

| ID | Item | Dono | Pronto quando |
|---|---|---|---|
| S-01 | **[contrato]** `JWT_SECRET` obrigatório em produção: falhar na inicialização se ausente, igual ao padrão ou curto; `devops-docs` garante a variável no deploy | backend-api + devops-docs | Boot com `NODE_ENV=production` sem segredo encerra com erro claro; teste cobre |
| S-02 | **[contrato]** `AdminGuard` ler `is_admin` do banco (`ControleAcesso.carregarFlags`), não do JWT | backend-api | Admin rebaixado/removido no banco perde acesso na próxima requisição; `it.failing` vira `it` |
| S-03 | **[contrato]** `GET /api/restaurantes/:id` com token de usuário removido: 403 `Usuário inválido.` (hoje pula o vínculo) | backend-api | Teste novo cobre; mesmo comportamento de `ListarRestaurantes` |
| S-04 | Rate limit em `/api/login` e `/login` (por IP e por username) e senha mínima maior no cadastro de usuário | backend-api | 429 após N tentativas; teste cobre |
| S-05 | Login sem enumeração de usuário: logar só id/hash, e `bcrypt.compare` fictício quando o usuário não existe | backend-api | Tempo de resposta equivalente; logs sem username |
| S-06 | Limite de body de `50mb` para `1mb` (json e urlencoded) | backend-api | Corpo grande retorna 413 |
| S-07 | CORS com lista de origens por variável de ambiente; `helmet`; fixar `algorithms: ['HS256']` no JWT | backend-api | Origem fora da lista é recusada; headers de segurança presentes |
| S-08 | **[contrato]** Validação de entrada: 500 vira 4xx em login com campo não-string, `:id` não numérico (`12abc` inclusive) em restaurantes/boletos, `nome` numérico, `cnpj`/`telefone` acima da coluna, `restaurante_id` inexistente no POST de boleto, id fora de int4 no PUT | backend-api | Os `it.failing` correspondentes viram `it` |
| S-09 | **[contrato]** `PUT /api/admin/usuarios-permissoes/:id` com `restaurante_ids` inválidos: 400 preservando vínculos (hoje 200 e o usuário fica sem vínculo) | backend-api | Igual ao POST; vínculos intactos no banco |
| S-10 | Regra de 1 dia na exclusão de boleto sem depender do fuso: comparar no SQL ou migrar `created_at` para `timestamptz` | backend-api + database-migrations | Teste com fuso diferente do banco passa |
| S-11 | `GET /api/health/ready` sem listar migrations pendentes para anônimos (ou protegido) | backend-api | Corpo público só diz ok/não ok |
| S-12 | `try/catch` e erro 503/500 uniforme em guards quando o banco falha (já resolvido no Nest; manter teste) | qa-tests | Teste de guard com banco caído |

## P2 — Produto

| ID | Item | Dono | Pronto quando |
|---|---|---|---|
| P-01 | Trocar de restaurante durante o uso, sem relogar (hoje só há a escolha inicial) | frontend-ui | Seletor no cabeçalho; E2E cobre; dados mudam sem recarregar |
| P-02 | Conferir `Boleto`, `SemanaResumo` e `Meta` em `frontend/src/types.ts` contra `src/boletos` | frontend-ui + qa-tests | Tipos batem campo a campo; teste de contrato do front |
| P-03 | Testes de tela do front (hoje só `Login` e `userPermissoes`): `BoletosModulo`, `AdminPermissoesUsuarios`, `CadastroRestaurantes` | qa-tests | Cobertura dos fluxos principais com Testing Library |
| P-04 | Feedback e acessibilidade: estados de carregamento e erro, foco, mensagens vindas da API | frontend-ui | Revisão manual + E2E |
| P-05 | **Decidido (23/10/2026):** leitura de boleto por foto (Gemini), anexo, baixa de pagamento e exclusão lógica entram no escopo, reescritos em tasks. Ver `docs/REQ-BOLETO-IA.md` | Todos | Tasks T0–T15 concluídas e validadas |
| P-06 | Levantar novas funções com o dono (exportar planilha, alertas de vencimento, relatório por fornecedor, recuperação de senha): hoje nenhuma existe | Você | Itens priorizados ou descartados |

## P3 — Dívida técnica

| ID | Item | Dono | Pronto quando |
|---|---|---|---|
| T-01 | Subir imagens base. Parte do Node feita em 23/10/2026 (`node:20-alpine` no back e no front, CI em Node 20). Falta: fixar `nginx:alpine`, revisar `@types/node` e vulnerabilidades, talvez Nest 11 | devops-docs + backend-api | Imagens sem vulnerabilidades críticas; suíte e E2E verdes |
| T-02 | Logs: tirar `console.log` de Login e CriarBoleto em produção; logger com níveis | backend-api | Nenhum dado sensível nos logs |
| T-03 | Testes unitários que faltam: casos de uso de metas, admin, restaurantes e health; guards, filtro de exceções e `JwtTokenService` | qa-tests | Cobertura sem depender do banco |
| T-04 | Enxugar sobreposição entre `contratoErrosBanco` e unitários (após as correções de segurança) | qa-tests | Suíte mais rápida sem perda de cobertura |
| T-05 | Banco por worker e E2E contra o build estático para paralelizar e acelerar | qa-tests + devops-docs | Suíte do backend mais rápida de forma mensurável |
| T-06 | Teste do boot (aviso de migrations pendentes) e do encerramento (`SIGTERM`) | qa-tests | Testes cobrem os dois |
| T-07 | Gerar os tipos do front a partir da API (contrato único) ou validar respostas com schema | frontend-ui + backend-api | Mudança no back quebra o build do front |
| T-08 | Script `start` do front sem `cross-env` (WSL) — decidir entre `start` e `start:unix` | frontend-ui | Um só comando documentado |
| T-09 | Consolidar docs: simplificar `docs/PLANO-DE-ACAO.md` (cumprido) e revisar `docs/HISTORICO-ETAPAS.md` | devops-docs | Docs curtos e sem referências a código removido |
| T-10 | Apagar branches locais já contidas (`chore/limpeza-projeto`, `feat/backend-nestjs`) e decidir o destino de `docs/reorganiza-documentacao`, `refactor/backend-modular`, `rollback/homologacao-para-main` e `feat/boleto-por-imagem` | Você | `git branch` só com o que é usado |

## Ordem sugerida

1. **Fechar o pacote de segurança** (S-01 a S-11) em `fix/seguranca-backend`: S-01 e S-02 primeiro, S-08 e S-09 em seguida, o restante em lote.
2. **Colocar em homologação** (B-01 a B-05), já com o código corrigido, e validar com o E2E.
3. **Produto** (P-01, P-02, P-03) enquanto a homologação é validada pelo cliente.
4. **Dívida técnica** (T-01 a T-10) em paralelo ou depois, conforme a capacidade.

## Decisões em aberto

- P-06: o que mais entra no roadmap de produto (P-05 já decidido).
- Subir o Node das imagens para 20+ (T-01) antes ou depois do primeiro deploy do Nest.
- Corrigir os bugs herdados (S-02, S-03, S-08, S-09) antes do primeiro deploy do Nest, o que muda o contrato para melhor, ou depois, em separado.
