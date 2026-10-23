> **Desatualizado:** este guia histórico cita `node server.js`/Nixpacks, que não existem mais. O deploy atual usa Docker: veja [docs/DEPLOY-DOCKER.md](../DEPLOY-DOCKER.md).

# Guia de Deploy no Easypanel.io

Este guia mostra como hospedar o banco de dados PostgreSQL e o backend Node.js no Easypanel.

## 📋 Pré-requisitos

- Conta no Easypanel.io criada
- Container PostgreSQL já criado no Easypanel
- Código do backend no GitHub (ou outro repositório Git)
- Domínio configurado (opcional, mas recomendado)

---

## 🔧 PARTE 1: Expor o PostgreSQL Externamente

### Passo 1.1: Acessar o Container PostgreSQL

1. No painel do Easypanel, encontre o serviço PostgreSQL que você criou
2. Clique no serviço para abrir as configurações

### Passo 1.2: Configurar Porta Externa

1. Na seção **"Ports"** ou **"Networking"** do container PostgreSQL:
   - **Porta Interna**: `5432` (porta padrão do PostgreSQL)
   - **Porta Externa**: Escolha uma porta (ex: `5433`, `5434`, ou deixe o Easypanel atribuir automaticamente)
   - **Tipo**: Selecione `TCP`

2. **IMPORTANTE**: Marque a opção **"Public"** ou **"Expose externally"** para permitir acesso externo

### Passo 1.3: Obter Informações de Conexão

Após configurar a porta, você terá acesso a:

- **Host**: O IP ou hostname do servidor Easypanel (ex: `your-server.easypanel.io`)
- **Porta Externa**: A porta que você configurou (ex: `5433`)
- **Usuário**: Geralmente `postgres` (ou o que você configurou)
- **Senha**: A senha que você definiu ao criar o container
- **Database**: O nome do banco (ex: `controle_financeiro`)

### Passo 1.4: Testar Conexão (Opcional)

Você pode testar a conexão usando um cliente PostgreSQL como pgAdmin ou DBeaver:
```
Host: seu-servidor.easypanel.io
Port: 5433 (ou a porta que você configurou)
Database: controle_financeiro
User: postgres
Password: sua-senha
```

---

## 🚀 PARTE 2: Deploy do Backend Node.js

### Passo 2.1: Preparar o Repositório

1. Certifique-se de que seu código está no GitHub/GitLab/Bitbucket
2. O Easypanel precisa de acesso ao repositório

### Passo 2.2: Criar Novo Serviço no Easypanel

1. No painel do Easypanel, clique em **"New Service"** ou **"Add Service"**
2. Selecione **"App"** ou **"Node.js"**
3. Escolha **"GitHub"** como fonte

### Passo 2.3: Configurar o Serviço

1. **Conectar GitHub**:
   - Autorize o Easypanel a acessar seu repositório
   - Selecione o repositório do projeto

2. **Configurações do Build**:
   - **Root Directory**: `backend` (o backend está na subpasta `backend/`)
   - **Build Command**: `npm install` (o Easypanel geralmente detecta automaticamente)
   - **Start Command**: `node server.js`
   - **Port**: `5000` (ou a porta que você usa no backend)
   
   **OU se usar Dockerfile**:
   - O Easypanel pode detectar automaticamente o Dockerfile em `backend/Dockerfile`
   - Neste caso, não precisa especificar build/start commands

3. **Variáveis de Ambiente**:
   Adicione as seguintes variáveis na seção **"Environment Variables"**:

   ```env
   NODE_ENV=production
   PORT=5000
   
   # Configurações do PostgreSQL (use os valores do container que você criou)
   DB_HOST=seu-servidor.easypanel.io
   DB_PORT=5433
   DB_NAME=controle_financeiro
   DB_USER=postgres
   DB_PASSWORD=sua-senha-postgres
   
   # JWT Secret (gere uma string aleatória segura)
   JWT_SECRET=sua-chave-secreta-jwt-aqui
   ```

   **⚠️ IMPORTANTE**: 
   - Use o **host externo** do PostgreSQL (não `localhost`)
   - Use a **porta externa** que você configurou
   - Mantenha as credenciais seguras

### Passo 2.4: Configurar Domínio e SSL

1. Na seção **"Domain"**:
   - Adicione seu domínio (ex: `api.seudominio.com`)
   - Ou use o domínio fornecido pelo Easypanel

2. **SSL Automático**:
   - Marque a opção **"Enable SSL"** ou **"Let's Encrypt"**
   - O Easypanel configurará automaticamente o certificado SSL

### Passo 2.5: Deploy

1. Clique em **"Deploy"** ou **"Save"**
2. O Easypanel irá:
   - Clonar o repositório
   - Instalar dependências (`npm install`)
   - Construir a aplicação
   - Iniciar o servidor

3. Aguarde o deploy completar (você verá os logs em tempo real)

---

## 🔗 PARTE 3: Conectar Backend ao PostgreSQL

### Passo 3.1: Verificar Conexão Interna

Se o backend e o PostgreSQL estiverem no mesmo servidor Easypanel, você pode usar:

- **Host Interno**: O nome do serviço PostgreSQL (ex: `postgres` ou `postgres-service`)
- **Porta Interna**: `5432`

Neste caso, as variáveis seriam:
```env
DB_HOST=postgres  # Nome do serviço PostgreSQL no Easypanel
DB_PORT=5432
```

### Passo 3.2: Usar Conexão Externa (Recomendado)

Para maior flexibilidade, use a conexão externa:

```env
DB_HOST=seu-servidor.easypanel.io
DB_PORT=5433  # Porta externa configurada
DB_NAME=controle_financeiro
DB_USER=postgres
DB_PASSWORD=sua-senha
```

---

## 📝 PARTE 4: Executar Migrações do Banco

### Passo 4.1: Acessar Terminal do Backend

1. No painel do Easypanel, abra o serviço do backend
2. Vá para a seção **"Terminal"** ou **"Console"**
3. Isso abrirá um terminal no navegador

### Passo 4.2: Executar Migrações

No terminal, execute:

```bash
cd backend  # Se necessário
npm run migrate
```

Ou execute manualmente:

```bash
node database/migrate.js
```

---

## ✅ PARTE 5: Verificar e Testar

### Passo 5.1: Verificar Logs

1. No painel do Easypanel, vá para **"Logs"** do serviço backend
2. Verifique se não há erros de conexão com o banco
3. Procure por mensagens como "Servidor rodando na porta 5000"

### Passo 5.2: Testar API

1. Obtenha a URL do backend (ex: `https://api.seudominio.com` ou o domínio do Easypanel)
2. Teste um endpoint:
   ```bash
   curl https://api.seudominio.com/api/verify
   ```

### Passo 5.3: Atualizar Frontend

No arquivo `frontend/src/config.js`, atualize a URL da API:

```javascript
export const API_URL = process.env.REACT_APP_API_URL || 'https://api.seudominio.com';
```

Ou use variável de ambiente:
```env
REACT_APP_API_URL=https://api.seudominio.com
```

---

## 🔒 PARTE 6: Segurança e Boas Práticas

### 6.1: Firewall e Acesso

- **PostgreSQL**: Considere restringir acesso por IP se possível
- **Backend**: Use HTTPS sempre (SSL automático do Easypanel)
- **Variáveis de Ambiente**: Nunca commite senhas no código

### 6.2: Backups

1. Configure backups automáticos do PostgreSQL no Easypanel
2. Ou use o recurso de backup do Easypanel (se disponível)

### 6.3: Monitoramento

- Use os logs do Easypanel para monitorar erros
- Configure alertas se disponível

---

## 🐛 Troubleshooting

### Erro: "Cannot connect to database"

**Solução**:
1. Verifique se o PostgreSQL está exposto externamente
2. Confirme as credenciais nas variáveis de ambiente
3. Verifique se a porta está correta
4. Teste a conexão externa com um cliente PostgreSQL

### Erro: "Port already in use"

**Solução**:
1. Verifique se outra aplicação não está usando a porta 5000
2. Altere a porta no backend se necessário

### Erro: "Module not found"

**Solução**:
1. Verifique se o `package.json` está no diretório correto
2. Confirme que o `npm install` foi executado durante o build

### Backend não inicia

**Solução**:
1. Verifique os logs no Easypanel
2. Confirme que o comando de start está correto
3. Verifique se todas as variáveis de ambiente estão configuradas

---

## 📚 Recursos Adicionais

- [Documentação do Easypanel](https://easypanel.io/docs)
- [Guia de Deploy Node.js](https://easypanel.io/docs/services/nodejs)
- [Configuração de PostgreSQL](https://easypanel.io/docs/services/postgresql)

---

## 📝 Checklist Final

- [ ] PostgreSQL exposto externamente com porta configurada
- [ ] Backend criado como novo serviço no Easypanel
- [ ] Variáveis de ambiente configuradas corretamente
- [ ] Domínio e SSL configurados
- [ ] Migrações do banco executadas
- [ ] API testada e funcionando
- [ ] Frontend atualizado com nova URL da API
- [ ] Backups configurados
- [ ] Logs monitorados

---

**Pronto!** Seu sistema deve estar funcionando no Easypanel. Se encontrar algum problema, consulte a seção de Troubleshooting ou os logs do Easypanel.
