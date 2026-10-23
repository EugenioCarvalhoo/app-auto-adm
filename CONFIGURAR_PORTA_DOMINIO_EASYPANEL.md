# 🌐 Configurar Porta e Domínio no Easypanel

Guia para configurar corretamente o acesso HTTP/HTTPS no Easypanel.

---

## 📋 ENTENDENDO A DIFERENÇA

### ❌ Portas (Published/Target)
- Para aplicações **NÃO web** (ex: banco de dados, serviços internos)
- Conecta diretamente via IP:Porta
- Não gerencia HTTP/HTTPS automaticamente

### ✅ Proxy/Domínios (Para Aplicações Web)
- Para aplicações **web HTTP/HTTPS**
- Gerenciamento automático de SSL/TLS
- Roteamento via domínio
- **Use isso para seu backend Node.js!**

---

## ✅ CONFIGURAÇÃO CORRETA PARA BACKEND WEB

### Opção 1: Usar Proxy/Domínios (Recomendado)

#### Passo 1: Configurar Porta Interna (Target)

1. **No serviço backend**, vá em **Settings** → **Ports**

2. **Configure apenas a porta TARGET** (porta interna):
   - **Target Port**: `5000` (porta que seu Node.js escuta)
   - **Published Port**: Deixe em branco ou não configure
   - **Protocol**: TCP (ou deixe padrão)

   ⚠️ **Não precisa publicar a porta externamente** - o proxy fará isso!

#### Passo 2: Configurar Domínio/Proxy

1. **No serviço backend**, vá em **Settings** → **Domains** (ou **Proxy**)

2. **Adicione um domínio**:
   - **Domain**: Ex: `api.seu-app.com` ou `backend.easypanel.io`
   - **Port**: `5000` (mesma porta que seu backend escuta internamente)
   - **Protocol**: `HTTP` (ou `HTTPS` se tiver SSL)

3. **Ou use o domínio fornecido pelo Easypanel**:
   - Geralmente algo como: `seu-app-123.easypanel.host`
   - Configure para apontar para a porta `5000`

4. **Salve**

#### Passo 3: Verificar

- Após salvar, você terá uma URL como: `https://api.seu-app.com` ou `https://seu-app-123.easypanel.host`
- O tráfego HTTP/HTTPS será roteado automaticamente para a porta `5000` interna

---

### Opção 2: Configurar Porta Publicada (Menos Recomendado)

**Use apenas se** precisar acessar diretamente via IP:Porta (sem proxy):

1. **Settings** → **Ports**
2. **Published Port**: Ex: `30000` (porta externa que você acessará)
3. **Target Port**: `5000` (porta interna do Node.js)
4. **Acesso**: `http://seu-ip:30000`

⚠️ **Não recomendo** para produção - use Proxy/Domínios!

---

## 🔧 CONFIGURAÇÃO COMPLETA: Backend

### 1. Variáveis de Ambiente

```env
NODE_ENV=production
PORT=5000
DB_HOST=seu-servidor.easypanel.io
DB_PORT=5433
DB_NAME=controle_financeiro
DB_USER=postgres
DB_PASSWORD=sua-senha
JWT_SECRET=sua-chave-secreta
```

**Importante**: `PORT=5000` - essa é a porta que seu código Node.js escuta **internamente**.

### 2. Porta Interna (Target)

**Settings** → **Ports**:
- **Target Port**: `5000`
- **Published Port**: Não precisa (proxy fará isso)

### 3. Domínio/Proxy

**Settings** → **Domains**:
- **Domain**: `api.seu-app.com` (ou domínio fornecido pelo Easypanel)
- **Port**: `5000`
- **Protocol**: `HTTP` ou `HTTPS`

---

## 📍 EXEMPLO VISUAL

```
Internet
   ↓
[Proxy Easypanel] ← Gerencia HTTP/HTTPS automaticamente
   ↓
[Backend Container] ← Escuta na porta 5000 (interna)
```

**Fluxo**:
1. Requisição: `https://api.seu-app.com/health`
2. Proxy roteia para: `localhost:5000` (dentro do container)
3. Backend responde na porta 5000

---

## 🎯 CONFIGURAÇÃO PRÁTICA

### Passo a Passo Completo:

1. **Configure variáveis de ambiente**:
   ```
   PORT=5000
   ... (outras variáveis)
   ```

2. **Configure porta TARGET** (Settings → Ports):
   - Target: `5000`

3. **Configure domínio** (Settings → Domains):
   - Domain: `backend-seu-projeto.easypanel.host` (ou seu domínio custom)
   - Port: `5000`

4. **Salve tudo**

5. **Acesse**: `https://backend-seu-projeto.easypanel.host/health`

---

## 🔍 VERIFICAÇÃO

### Testar se está funcionando:

1. **No navegador ou curl**:
   ```bash
   curl https://seu-dominio.easypanel.host/health
   ```

   **Resposta esperada**:
   ```json
   {
     "status": "ok",
     "database": "connected",
     "timestamp": "2026-01-18T..."
   }
   ```

2. **Ou testar login**:
   ```bash
   curl -X POST https://seu-dominio.easypanel.host/api/login \
     -H "Content-Type: application/json" \
     -d '{"username":"admin","password":"senha"}'
   ```

---

## ⚠️ PROBLEMAS COMUNS

### Erro: "Cannot reach service"

**Solução**:
1. Verifique se a **Target Port** está configurada como `5000`
2. Confirme que o backend está rodando (`PORT=5000` nas variáveis)
3. Verifique os **logs** para ver se há erros

### Erro: "404 Not Found"

**Solução**:
1. Confirme que o **domínio está apontando para a porta correta** (`5000`)
2. Teste a rota `/health` primeiro
3. Verifique se o backend está realmente escutando na porta 5000

### Erro: "Connection refused"

**Solução**:
1. O backend pode não estar rodando
2. Verifique os **logs** do serviço
3. Confirme que `PORT=5000` está nas variáveis de ambiente

---

## 📚 RESUMO

| Item | Valor | Onde Configurar |
|------|-------|-----------------|
| **Porta Interna** | `5000` | Settings → Ports → Target Port |
| **Variável PORT** | `5000` | Settings → Environment Variables |
| **Domínio** | `seu-dominio.easypanel.host` | Settings → Domains |
| **Porta do Domínio** | `5000` | Settings → Domains → Port |

---

## ✅ CHECKLIST

Antes de considerar completo:

- [ ] Variável `PORT=5000` configurada
- [ ] Target Port `5000` configurada (Settings → Ports)
- [ ] Domínio configurado apontando para porta `5000` (Settings → Domains)
- [ ] Serviço reiniciado após configurações
- [ ] Teste `/health` retorna `200 OK`
- [ ] URL do domínio acessível no navegador

---

## 🎉 RESULTADO FINAL

Após configurar:

- ✅ Backend acessível via: `https://seu-dominio.easypanel.host`
- ✅ Proxy gerencia SSL/TLS automaticamente
- ✅ Roteamento automático para porta 5000 interna
- ✅ Pronto para conectar com frontend!

**Agora você pode usar essa URL no frontend** (`frontend/src/config.js`)! 🚀
