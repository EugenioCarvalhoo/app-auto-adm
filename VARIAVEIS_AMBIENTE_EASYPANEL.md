# 🔐 Configurar Variáveis de Ambiente no Easypanel

Guia passo a passo para configurar as variáveis de ambiente necessárias para o backend.

---

## 📍 ONDE CONFIGURAR

### Localização no Easypanel:

1. **Acesse o serviço do backend** que você criou
2. **Clique em "Settings"** (Configurações) ou **⚙️**
3. **Vá para a seção "Environment Variables"** ou **"Variáveis de Ambiente"**
   - Pode estar em: **"Environment"**, **"Env Vars"**, ou **"Variables"**

---

## ✅ VARIÁVEIS NECESSÁRIAS

Adicione as seguintes variáveis de ambiente:

### 1. Variáveis do Node.js

```env
NODE_ENV=production
PORT=5000
```

### 2. Variáveis do PostgreSQL

```env
DB_HOST=seu-servidor.easypanel.io
DB_PORT=5433
DB_NAME=controle_financeiro
DB_USER=postgres
DB_PASSWORD=sua-senha-postgres-aqui
```

**⚠️ IMPORTANTE**:
- `DB_HOST`: Use o **host externo** do seu servidor Easypanel (não `localhost`)
- `DB_PORT`: Use a **porta externa** que você configurou para o PostgreSQL (ex: `5433`)
- `DB_PASSWORD`: A senha que você definiu ao criar o container PostgreSQL

### 3. Variável JWT Secret

```env
JWT_SECRET=uma-chave-secreta-aleatoria-e-segura-aqui
```

**💡 Dica**: Gere uma string aleatória longa. Exemplo:
- Use um gerador online de strings aleatórias
- Ou gere no terminal: `openssl rand -base64 32`

---

## 📝 COMO ADICIONAR NO EASYPANEL

### Passo a Passo:

1. **No serviço do backend**, clique em **"Settings"** (⚙️)

2. **Procure por**:
   - **"Environment Variables"**
   - **"Environment"**
   - **"Env Vars"**
   - **"Variables"**

3. **Você verá uma interface com**:
   - Campo para **Key** (Chave)
   - Campo para **Value** (Valor)
   - Botão **"Add"** ou **"Add Variable"**

4. **Adicione cada variável uma por uma**:

   **Variável 1:**
   - Key: `NODE_ENV`
   - Value: `production`
   - Clique em **"Add"** ou **"Save"**

   **Variável 2:**
   - Key: `PORT`
   - Value: `5000`
   - Clique em **"Add"** ou **"Save"**

   **Variável 3:**
   - Key: `DB_HOST`
   - Value: `seu-servidor.easypanel.io` (substitua pelo seu host)
   - Clique em **"Add"** ou **"Save"**

   **Variável 4:**
   - Key: `DB_PORT`
   - Value: `5433` (ou a porta que você configurou)
   - Clique em **"Add"** ou **"Save"**

   **Variável 5:**
   - Key: `DB_NAME`
   - Value: `controle_financeiro`
   - Clique em **"Add"** ou **"Save"**

   **Variável 6:**
   - Key: `DB_USER`
   - Value: `postgres`
   - Clique em **"Add"** ou **"Save"**

   **Variável 7:**
   - Key: `DB_PASSWORD`
   - Value: `sua-senha-postgres` (a senha real do PostgreSQL)
   - Clique em **"Add"** ou **"Save"**

   **Variável 8:**
   - Key: `JWT_SECRET`
   - Value: `uma-chave-secreta-aleatoria` (gere uma chave segura)
   - Clique em **"Add"** ou **"Save"**

5. **Após adicionar todas**, clique em **"Save"** ou **"Apply"** (se houver)

6. **Reinicie o serviço** (se necessário):
   - O Easypanel pode reiniciar automaticamente
   - Ou procure por botão **"Restart"** ou **"Redeploy"**

---

## 🔍 ONDE ENCONTRAR AS INFORMAÇÕES DO BANCO

### DB_HOST e DB_PORT:

1. **Acesse o serviço PostgreSQL** no Easypanel
2. **Vá em "Settings" → "Ports" ou "Networking"**
3. **Anote**:
   - **Host externo**: Geralmente algo como `seu-servidor.easypanel.io` ou um IP
   - **Porta externa**: A porta que você configurou (ex: `5433`)

### DB_PASSWORD:

- É a senha que você definiu ao criar o container PostgreSQL
- Se não lembrar, você pode:
  - Verificar nas configurações do PostgreSQL
  - Ou redefinir no container PostgreSQL

---

## 📋 EXEMPLO COMPLETO

Aqui está um exemplo de como ficaria preenchido:

```
NODE_ENV = production
PORT = 5000
DB_HOST = meu-servidor-123.easypanel.io
DB_PORT = 5433
DB_NAME = controle_financeiro
DB_USER = postgres
DB_PASSWORD = MinhaSenhaSegura123!
JWT_SECRET = xK9mP2qR7vT4wY8zA1bC3dE5fG6hI0jK2lM4nO6pQ8rS
```

---

## ✅ VERIFICAR SE ESTÁ FUNCIONANDO

### 1. Verificar Logs

Após configurar as variáveis e reiniciar:

1. **Vá em "Logs"** do serviço backend
2. **Procure por**:
   - ✅ `Conectado ao PostgreSQL: ...` (sucesso)
   - ✅ `Servidor rodando na porta 5000` (sucesso)
   - ❌ `Erro ao conectar ao banco de dados` (verificar variáveis)

### 2. Testar Conexão

No terminal do backend (se disponível):

```bash
echo $DB_HOST
echo $DB_PORT
echo $DB_NAME
```

Isso mostrará se as variáveis estão sendo lidas.

---

## 🆘 Problemas Comuns

### Variáveis não estão sendo aplicadas

**Solução**:
1. Confirme que clicou em **"Save"** ou **"Apply"**
2. **Reinicie o serviço** após adicionar variáveis
3. Verifique se não há espaços extras nos valores

### Erro: "Cannot connect to database"

**Solução**:
1. Verifique se `DB_HOST` está correto (não use `localhost`)
2. Confirme que `DB_PORT` é a porta **externa** do PostgreSQL
3. Verifique se o PostgreSQL está marcado como **"Public"** ou **"Expose externally"**
4. Teste a conexão com um cliente PostgreSQL usando essas credenciais

### Erro: "Authentication failed"

**Solução**:
1. Verifique se `DB_USER` está correto (geralmente `postgres`)
2. Confirme que `DB_PASSWORD` está correta
3. Teste fazer login manualmente no PostgreSQL com essas credenciais

---

## 🔐 Segurança

### Boas Práticas:

1. **Nunca commite variáveis** no código
2. **Use senhas fortes** para `DB_PASSWORD` e `JWT_SECRET`
3. **Não compartilhe** as variáveis publicamente
4. **Revise periodicamente** as credenciais

### JWT_SECRET:

- Deve ser uma string longa e aleatória
- Mínimo recomendado: 32 caracteres
- Use caracteres alfanuméricos e símbolos

**Exemplos de geração**:
```bash
# No terminal Linux/Mac
openssl rand -base64 32

# Ou use um gerador online
```

---

## 📚 Checklist Final

Antes de considerar completo:

- [ ] NODE_ENV configurada
- [ ] PORT configurada
- [ ] DB_HOST configurado (host externo)
- [ ] DB_PORT configurado (porta externa)
- [ ] DB_NAME configurado
- [ ] DB_USER configurado
- [ ] DB_PASSWORD configurada (senha correta)
- [ ] JWT_SECRET configurado (chave segura)
- [ ] Todas as variáveis salvas
- [ ] Serviço reiniciado
- [ ] Logs verificados (sem erros de conexão)

---

## 🎯 Localização Visual no Easypanel

```
Serviço Backend
├── Overview (Visão geral)
├── Logs (Logs)
├── Settings (⚙️ Configurações) ← AQUI!
│   ├── General
│   ├── Environment Variables ← AQUI ESTÁ!
│   ├── Networking
│   └── Advanced
└── Terminal
```

**Pronto!** Após configurar todas as variáveis, o backend deve conseguir se conectar ao PostgreSQL! 🚀
