# 🔧 Corrigir Conexão PostgreSQL: Erro ECONNREFUSED

Guia para corrigir o erro de conexão ao PostgreSQL no Easypanel.

---

## 🔍 PROBLEMA IDENTIFICADO

```
❌ erro ao conectar ao banco de dados: error: connect ECONNREFUSED 127.0.0.1:5432
```

**Causa**: O backend está tentando conectar em `127.0.0.1:5432` (localhost), mas o PostgreSQL está em **outro container/servidor**.

---

## ✅ SOLUÇÃO

### O PostgreSQL e o Backend são containers separados!

**Não use `localhost`** - use o **host externo** do PostgreSQL.

---

## 🔧 CORRIGIR VARIÁVEIS DE AMBIENTE

### 1. Encontrar o Host do PostgreSQL

**No Easypanel**:

1. **Acesse o serviço PostgreSQL**
2. **Settings** → **Networking** ou **Ports**
3. **Anote**:
   - **Host externo**: Ex: `postgres-123.easypanel.io` ou um IP
   - **Porta externa**: Ex: `5433` (não 5432 se for porta externa)

### 2. Configurar Variáveis do Backend

**No serviço backend** → **Settings** → **Environment Variables**:

```env
NODE_ENV=production
PORT=5000
DB_HOST=postgres-123.easypanel.io
DB_PORT=5433
DB_NAME=controle_financeiro
DB_USER=postgres
DB_PASSWORD=sua-senha-postgres
JWT_SECRET=sua-chave-secreta
```

**⚠️ IMPORTANTE**:
- **`DB_HOST`**: Use o **host externo** do PostgreSQL (não `localhost`!)
- **`DB_PORT`**: Use a **porta externa** do PostgreSQL (geralmente `5433`, não `5432`)

---

## 🔍 ONDE ENCONTRAR DB_HOST E DB_PORT

### Opção 1: No Serviço PostgreSQL

1. **Acesse o serviço PostgreSQL**
2. **Settings** → **Networking** ou **Ports**
3. Procure por:
   - **Public Host** ou **External Host**
   - **Published Port** ou **External Port**

### Opção 2: Verificar URL de Conexão

Se o PostgreSQL tiver uma **URL de conexão** no Easypanel:
- Pode ser algo como: `postgresql://postgres:senha@postgres-123.easypanel.io:5433/controle_financeiro`
- Extraia o **host** (`postgres-123.easypanel.io`) e **porta** (`5433`)

---

## 📋 EXEMPLO PRÁTICO

### Cenário Comum no Easypanel:

**PostgreSQL**:
- Host externo: `postgres-multi-app-123.easypanel.host`
- Porta externa: `5433`

**Variáveis no Backend**:
```env
DB_HOST=postgres-multi-app-123.easypanel.host
DB_PORT=5433
```

**❌ ERRADO**:
```env
DB_HOST=localhost      # ❌ Não funciona!
DB_HOST=127.0.0.1      # ❌ Não funciona!
DB_PORT=5432           # ❌ Pode estar errado!
```

**✅ CORRETO**:
```env
DB_HOST=postgres-multi-app-123.easypanel.host  # ✅ Host externo!
DB_PORT=5433                                    # ✅ Porta externa!
```

---

## 🛠️ PASSOS PARA CORRIGIR

### 1. Identificar Host e Porta do PostgreSQL

```
Settings → PostgreSQL → Networking/Ports
```

Anote:
- **Host**: `_________________`
- **Porta**: `_________________`

### 2. Atualizar Variáveis do Backend

```
Settings → Backend → Environment Variables
```

Altere:
- `DB_HOST` = host anotado acima
- `DB_PORT` = porta anotada acima

### 3. Salvar e Reiniciar

1. **Salve** as variáveis
2. **Reinicie** o serviço backend
3. **Verifique logs** - deve conectar sem erro!

---

## ✅ VERIFICAÇÃO

### Após corrigir, os logs devem mostrar:

```
✅ Servidor rodando na porta 5000
✅ Conectado ao PostgreSQL: 2026-01-18...
```

**Sem erros de conexão!**

---

## 🔍 TESTE MANUAL

### Se quiser testar a conexão manualmente:

**No terminal do backend**, teste:

```bash
# Ver variáveis
echo $DB_HOST
echo $DB_PORT

# Testar conexão (se psql estiver disponível)
psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -c "SELECT 1;"
```

---

## ⚠️ PROBLEMAS COMUNS

### Erro persiste após corrigir?

1. **Verifique se o PostgreSQL está rodando**
   - Veja logs do PostgreSQL
   - Confirme que está ativo

2. **Verifique se a porta está exposta**
   - PostgreSQL deve ter **porta externa** configurada
   - Não apenas porta interna

3. **Verifique credenciais**
   - `DB_USER` correto? (geralmente `postgres`)
   - `DB_PASSWORD` correta?
   - `DB_NAME` existe?

4. **Verifique firewall/rede**
   - O PostgreSQL precisa permitir conexões externas
   - Verifique configurações de rede no Easypanel

---

## 📚 RESUMO

| Item | Valor Errado ❌ | Valor Correto ✅ |
|------|----------------|------------------|
| **DB_HOST** | `localhost` ou `127.0.0.1` | Host externo do PostgreSQL |
| **DB_PORT** | `5432` (pode ser interno) | Porta **externa** do PostgreSQL |
| **DB_USER** | Qualquer | Geralmente `postgres` |
| **DB_PASSWORD** | Errada | Senha correta do PostgreSQL |
| **DB_NAME** | Inexistente | `controle_financeiro` |

---

## 🎯 AÇÃO IMEDIATA

1. **Vá no serviço PostgreSQL** → **Settings** → **Networking**
2. **Anote o host e porta externos**
3. **Vá no backend** → **Settings** → **Environment Variables**
4. **Atualize `DB_HOST` e `DB_PORT`**
5. **Salve e reinicie**

**Isso deve resolver o erro ECONNREFUSED!** 🚀
