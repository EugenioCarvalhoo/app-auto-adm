# Requisito urgente — Cadastro de boletos por imagem com IA (Gemini Flash)

Aberto em 23/10/2026. Branch de trabalho: `feat/boleto-ia` (a partir de `desenvolvimento`). Substitui a decisão P-05 do `docs/BACKLOG.md`.

## 1. Objetivo
O usuário fotografa (ou envia) um boleto ou nota, a IA do Gemini lê a imagem e **sugere** os campos do lançamento; o usuário confere, corrige e salva. A IA nunca grava sozinha.

## 2. Decisões do dono (23/10/2026)
- **Escopo:** tudo o que a branch antiga `feat/boleto-por-imagem` tinha: leitura por IA, anexo da imagem, baixa de pagamento e exclusão lógica (soft delete).
- **Execução:** task a task, com validação a cada uma antes de seguir.
- **Código antigo:** não reaproveitar. Reescrever na arquitetura limpa do Nest (`backend/src/boletos`), usando a branch antiga só como referência de decisões.
- **Imagem:** guardada num **volume local** atrás de uma porta (`Storage`) abstraída, de modo que trocar por S3-compatível (MinIO, R2, S3) seja só um novo adaptador.
- **Modelo:** família Gemini Flash, configurável por `GEMINI_MODEL` (confirmar o identificador vigente na documentação do Google na task T4).
- **Integração (revisto em 23/10/2026):** chamada **direta à API REST do Gemini** com `fetch` nativo, sem SDK (o `@google/genai` foi tentado primeiro e removido por decisão do dono). Modelo padrão `gemini-3.8-flash` (o 2.5 Flash não é mais liberado para projetos novos), configurável por `GEMINI_MODEL`. Atrás da porta `ExtratorBoleto`, para o resto do sistema não conhecer o provedor.
- **Ordem e entrega em duas partes:** **T4 a T6 vêm primeiro.** O backend (T4 e T5) é entregue e **o dono testa a API** (Marco 1A) antes de o frontend (T6) começar. Só depois do Marco 1B seguem anexo, baixa e exclusão lógica.

## 3. Requisitos
**Funcionais**
- RF-IA-01: enviar imagem (JPEG, PNG ou WebP) de um restaurante liberado ao usuário e receber sugestão de `tipo`, `fornecedor/descrição`, `valor`, `dt_vencimento`, `dt_recebimento` e linha digitável.
- RF-IA-02: o formulário é preenchido com a sugestão, com os campos sugeridos sinalizados; nada é salvo até o usuário confirmar.
- RF-IA-03: ao salvar, a imagem fica anexada ao boleto e pode ser vista por quem tem acesso ao restaurante.
- RF-IA-04: marcar um boleto como pago (e desfazer), com data do pagamento.
- RF-IA-05: excluir passa a ser lógico (`deleted_at`); excluídos saem de listas, resumo e metas. O admin consegue consultar e restaurar.
- RF-IA-06: limite diário de leituras por usuário (valor configurável).

**Não funcionais**
- Saída da IA é **dado não confiável**: validada e saneada (schema manual, valor em centavos, datas reais, linha digitável com dígito verificador); campo inválido vira `null`.
- Segurança do upload: tipo verificado pelo conteúdo (magic bytes), tamanho máximo, chave de arquivo gerada pelo servidor (sem path traversal), acesso ao anexo checado por `restaurante_id` do registro.
- `GEMINI_API_KEY` só em variável de ambiente; nunca em log, resposta ou commit. Sem a chave, o endpoint responde 503.
- Contrato atual da API não muda; só se acrescenta (rotas novas e campos novos opcionais). Back, `BoletosModulo.tsx` e `types.ts` mudam na mesma task (regra do `CLAUDE.md`).
- Testes sem chamar o Gemini de verdade (extrator falso/servidor mock).
- Custo controlado: limite diário, imagem reduzida no cliente, timeout por chamada.

## 4. Tasks

Cada task termina com: testes verdes (`qa-tests`), `typecheck` e `build`, commit na `feat/boleto-ia`, e **sua validação antes da próxima**. **Ordem de execução:** T4 → T5 → **Marco 1A (você testa a API)** → T6 → **Marco 1B** → depois T0/T1/T2/T3 (volume e anexo), T7 em diante. T4 e T5 só precisam das variáveis de ambiente e da tabela do limite diário (migration 018, abaixo); a tabela de anexos (`boletos_anexos`) fica para a T7.

| Task | Descrição | Dono | Depende | Critério de aceite |
|---|---|---|---|---|
| **T0** | *(parcial em T4/T5)* Preparar: variáveis em `backend/.env.example` (`GEMINI_API_KEY`, `GEMINI_MODEL`, `GEMINI_TIMEOUT_MS`, `EXTRAIR_LIMITE_DIARIO`, `STORAGE_DRIVER`, `STORAGE_DIR`, `IMAGEM_MAX_MB`); atualizar `CLAUDE.md` com o novo escopo | devops-docs | — | Variáveis documentadas sem valores secretos |
| **T1** | Migrations aditivas (sem `DROP`), em duas partes: **T1a** (feita junto da T5) `018_boletos_extracoes_uso` (usuário, dia, total, PK usuário+dia) para o limite diário; **T1b** (na T7) `boletos_anexos` (boleto, restaurante, usuário, chave, mime, tamanho, hash). Entram em `lista-migrations.js` | database-migrations | T0 | `npm run migrate` aplica e é idempotente; teste de upgrade cobre |
| **T2** | Porta `Storage` (`salvar`, `ler`, `apagar`) no domínio/aplicação e adaptador de **volume local** (`STORAGE_DIR`), chave gerada pelo servidor, proteção contra path traversal, `503` quando não configurado | backend-api | T0 | Testes de unidade do adaptador; porta substituível por fake |
| **T3** | Volume no Docker: volume nomeado no `docker-compose.yml`, diretório com dono `node` no Dockerfile, instrução de volume no Easypanel em `docs/DEPLOY-DOCKER.md` | devops-docs | T2 | Arquivo sobrevive a `docker compose down && up` |
| **T4** | Porta `ExtratorBoleto` e adaptador Gemini via **API REST direta (`fetch`)** (resposta em JSON estruturado, timeout, chave por env, modelo por `GEMINI_MODEL`); domínio: saneamento da extração, validação da linha digitável, saneamento de fornecedor | backend-api | T0 (variáveis) | Testes com extrator falso e com respostas malformadas/hostis (texto injetado na imagem, JSON inválido, valores absurdos); provedor isolado atrás da porta |
| **T5** | `POST /api/boletos/extrair` (multipart: `restaurante_id`, `imagem`): valida acesso ao restaurante, tipo por magic bytes, tamanho, limite diário atômico (429), 503 sem chave; devolve sugestão **sem gravar boleto** | backend-api (+ database-migrations para a 018) | T1a, T4 | Contrato e erros testados (400/401/403/413/415/429/503); extrator falso; nada gravado |
| ✅ **Marco 1A** | **Você testa a API** (`POST /api/boletos/extrair`) com uma chave de homologação e boletos reais, via Postman/curl, antes de o frontend começar | você | T4, T5 | Leitura correta nos casos reais; erros 4xx/429/503 como documentado |
| **T6** | *(só após o Marco 1A)* Frontend: botão de foto/arquivo, redução da imagem no cliente, estados de carregando/erro, formulário preenchido com campos sinalizados como "sugerido pela IA"; `types.ts` | frontend-ui | T5, Marco 1A | Fluxo completo no navegador com Gemini mockado; E2E com servidor mock |
| ✅ **Marco 1B** | Leitura por IA ponta a ponta na interface | você | T6 | Cadastro real de boleto pela foto, em homologação |
| **T7** | Anexo: salvar a imagem junto do boleto (na criação/edição), `GET /api/boletos/:id/anexo` (acesso por `restaurante_id` do registro, `Content-Type` correto, sem listar caminho), remover anexo junto do boleto conforme a política de exclusão | backend-api | T1, T2, T5 | IDOR coberto; anexo de outro restaurante dá 403 |
| **T8** | Frontend: ver o anexo no boleto; `types.ts` | frontend-ui | T7 | Imagem abre para quem tem acesso e para mais ninguém |
| **T9** | Baixa de pagamento: migration (`pago_em`/situação), `PUT /api/boletos/:id/pagamento` e desfazer; resumo semanal e metas passam a considerar a situação | database-migrations + backend-api | T1 | Regras de cálculo testadas em centavos; contrato documentado |
| **T10** | Frontend: marcar/desfazer pago e mostrar situação na lista e no dashboard | frontend-ui | T9 | E2E cobre o fluxo |
| **T11** | Exclusão lógica: migration (`deleted_at`, `deleted_por`), `DELETE` vira lógico (mantendo a regra de 1 dia para não-admin), listas/resumo/metas ignoram excluídos; admin lista e restaura | database-migrations + backend-api | T1 | Nenhuma consulta devolve excluído; restauração testada; isolamento por restaurante preservado |
| **T12** | Frontend: tela do admin para excluídos/restaurar; `types.ts` | frontend-ui | T11 | E2E cobre |
| **T13** | Auditoria de segurança do conjunto: upload (spoof de tipo, tamanho, path traversal), prompt injection pela imagem, IDOR em anexo/pagamento/restauração, vazamento da chave em log, abuso de custo | security-reviewer | T5–T12 | Relatório sem crítico/alto em aberto |
| **T14** | Cobertura final e E2E completo (Gemini mockado), docs e guia de deploy (volume, variáveis, chave como secret no Easypanel), atualizar `docs/HISTORICO-ETAPAS.md` e o backlog | qa-tests + devops-docs | tudo | CI verde; você roda o E2E |
| **T15** *(depois)* | Adaptador S3-compatível para `Storage` (MinIO/R2/S3), `STORAGE_DRIVER=s3` | backend-api | T2 | Mesma suíte da porta passa nos dois adaptadores |

## 5. Pontos a decidir ao chegar na task
- **T5:** valor do limite diário (`EXTRAIR_LIMITE_DIARIO`), tamanho máximo da imagem e identificador do modelo Flash vigente.
- **T7:** política de retenção do anexo quando o boleto é excluído (manter por quanto tempo).
- **T9:** efeito da baixa no dashboard: pago sai do total "a pagar" da semana ou continua no total e aparece separado?
- **T11:** o admin vê e restaura excluídos em tela própria ou como filtro na lista? Não-admin vê os seus excluídos?

## 6. Riscos
- **Privacidade:** a imagem do boleto (dados de fornecedor e valores) é enviada ao Google. Usar chave de um projeto com plano pago, onde os dados não são usados para treinamento, e avisar o dono. Decisão do dono antes do Marco 1.
- **Custo e abuso:** mitigado por limite diário, redução da imagem e timeout.
- **Qualidade da leitura:** sempre há confirmação humana; medir a taxa de campos corrigidos após o Marco 1.
- **Disco:** volume local não replica nem escala; o adaptador S3 (T15) resolve quando necessário. Incluir backup do volume no deploy.
