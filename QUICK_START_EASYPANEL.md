# 🚀 Quick Start - Easypanel Deploy

## ⚡ Passos Rápidos

### 1️⃣ Expor PostgreSQL (5 minutos)

1. **Acesse seu container PostgreSQL no Easypanel**
2. **Vá em "Settings" → "Ports" ou "Networking"**
3. **Configure**:
   ```
   Internal Port: 5432
   External Port: 5433 (ou qualquer porta disponível)
   Protocol: TCP
   Public: ✅ (marque esta opção!)
   ```
4. **Salve** e anote:
   - Host: `seu-servidor.easypanel.io`
   - Port: `5433` (ou a que você escolheu)
   - User: `postgres`
   - Password: `sua-senha`
   - Database: `controle_financeiro`

### 2️⃣ Deploy do Backend (10 minutos)

1. **Criar novo serviço** → **App** → **Node.js**
2. **Conectar GitHub** → selecionar repositório
3. **Configurar**:
   - Root Directory: `backend`
   - Port: `5000`
4. **Variáveis de Ambiente**:
   ```env
   NODE_ENV=production
   PORT=5000
   DB_HOST=seu-servidor.easypanel.io
   DB_PORT=5433
   DB_NAME=controle_financeiro
   DB_USER=postgres
   DB_PASSWORD=sua-senha-postgres
   JWT_SECRET=uma-chave-secreta-aleatoria-aqui
   ```
5. **Domain**: Adicione seu domínio (ou use o do Easypanel)
6. **SSL**: Ative Let's Encrypt
7. **Deploy!**

### 3️⃣ Executar Migrações (2 minutos)

1. **Terminal do Backend** no Easypanel
2. Execute:
   ```bash
   cd backend
   npm run migrate
   ```

### 4️⃣ Atualizar Frontend

No `frontend/src/config.js` ou variável de ambiente:
```javascript
REACT_APP_API_URL=https://api.seudominio.com
```

---

## 🔍 Onde encontrar no Easypanel

### PostgreSQL - Expor Porta:
```
Serviço PostgreSQL → Settings → Ports/Networking → Add Port
```

### Backend - Variáveis de Ambiente:
```
Serviço Backend → Settings → Environment Variables → Add Variable
```

### Terminal/Console:
```
Serviço Backend → Terminal (ou Console) → Abrir terminal
```

---

## ⚠️ Dicas Importantes

1. **PostgreSQL Host**: Use o host externo, não `localhost`
2. **Porta Externa**: Use a porta que você configurou (ex: 5433)
3. **SSL**: Sempre ative HTTPS no backend
4. **Senhas**: Nunca commite senhas no código
5. **Teste**: Sempre teste a conexão antes de fazer deploy

---

## 🆘 Problemas Comuns

**"Cannot connect to database"**
→ Verifique se o PostgreSQL está marcado como "Public"
→ Confirme host e porta nas variáveis de ambiente

**"Port 5000 already in use"**
→ Altere a porta no backend ou configure outra porta

**"Module not found"**
→ Verifique se o Root Directory está como `backend`

---

📖 **Guia completo**: Veja `DEPLOY_EASYPANEL.md` para detalhes
