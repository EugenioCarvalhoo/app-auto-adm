# 🔒 Corrigir Mixed Content: HTTPS → HTTP

O frontend está em HTTPS, mas tenta acessar o backend via HTTP, causando erro de Mixed Content.

---

## 🔍 PROBLEMA

**Erro**:
```
Mixed Content: The page at 'https://...' was loaded over HTTPS, 
but requested an insecure XMLHttpRequest endpoint 'http://...:5000/api/login'. 
This request has been blocked
```

**Causa**: Frontend em HTTPS tentando acessar backend via HTTP.

---

## ✅ SOLUÇÃO

### Opção 1: Configurar REACT_APP_API_URL com HTTPS (Recomendado)

**No Easypanel** (serviço frontend):

1. **Settings** → **Environment Variables**
2. **Verifique** `REACT_APP_API_URL`:
   - ❌ **Errado**: `http://multi-app-financialmanagementapp.dtun51.easypanel.host/api`
   - ✅ **Correto**: `https://multi-app-financialmanagementapp.dtun51.easypanel.host/api`

3. **Altere para HTTPS**:
   ```env
   REACT_APP_API_URL=https://multi-app-financialmanagementapp.dtun51.easypanel.host/api
   ```

4. **Salve** e **Redeploy** o frontend

---

### Opção 2: Atualizar config.js para Usar HTTPS Automaticamente

Se a variável não estiver configurada, o `config.js` tenta detectar automaticamente, mas usa HTTP. Vamos corrigir:

**Atualizar `frontend/src/config.js`**:

```javascript
const getApiUrl = () => {
  // Se está definido nas variáveis de ambiente, usa
  if (process.env.REACT_APP_API_URL) {
    return process.env.REACT_APP_API_URL;
  }
  
  // Se está acessando de outro dispositivo (não localhost)
  const hostname = window.location.hostname;
  const protocol = window.location.protocol; // 'https:' ou 'http:'
  
  if (hostname !== 'localhost' && hostname !== '127.0.0.1') {
    // Usa o mesmo protocolo da página atual (HTTPS em produção)
    return `${protocol}//${hostname}:5000/api`;
  }
  
  // Default: localhost (desenvolvimento)
  return 'http://localhost:5000/api';
};
```

**Ou melhor ainda**, se o backend estiver no mesmo domínio (sem porta):

```javascript
const getApiUrl = () => {
  // Se está definido nas variáveis de ambiente, usa
  if (process.env.REACT_APP_API_URL) {
    return process.env.REACT_APP_API_URL;
  }
  
  // Se está acessando de outro dispositivo (não localhost)
  const hostname = window.location.hostname;
  const protocol = window.location.protocol; // 'https:' ou 'http:'
  
  if (hostname !== 'localhost' && hostname !== '127.0.0.1') {
    // Detecta se é o mesmo domínio do backend ou diferente
    // Se for o mesmo domínio, não precisa da porta
    return `${protocol}//multi-app-financialmanagementapp.dtun51.easypanel.host/api`;
  }
  
  // Default: localhost (desenvolvimento)
  return 'http://localhost:5000/api';
};
```

---

## 🎯 SOLUÇÃO RECOMENDADA

**Configure a variável `REACT_APP_API_URL` no Easypanel**:

1. **Frontend** → **Settings** → **Environment Variables**
2. **Adicione/Altere**:
   ```env
   REACT_APP_API_URL=https://multi-app-financialmanagementapp.dtun51.easypanel.host/api
   ```
3. **IMPORTANTE**: Use `https://` não `http://`
4. **Salve**
5. **Redeploy** o frontend (pode precisar fazer push novo ou forçar rebuild)

---

## 🔧 ATUALIZAR CONFIG.JS (Backup)

Se preferir garantir que sempre use HTTPS quando a página for HTTPS, atualize o `config.js`:

Vou atualizar o arquivo para você!

---

## ✅ VERIFICAÇÃO

Após corrigir:

1. **Redeploy** do frontend
2. **Acesse**: `https://multi-app-financialmanagement.dtun51.easypanel.host/`
3. **Abra DevTools** → **Network**
4. **Faça login**
5. **Verifique** que as requisições vão para:
   - ✅ `https://multi-app-financialmanagementapp.dtun51.easypanel.host/api/login`
   - ❌ NÃO `http://...`

---

## 📋 CHECKLIST

- [ ] `REACT_APP_API_URL` configurada com `https://` no Easypanel?
- [ ] Frontend redeployado após alterar variável?
- [ ] Requisições agora vão para HTTPS?
- [ ] Login funciona sem erro de Mixed Content?

---

**A solução mais rápida: Configure `REACT_APP_API_URL=https://...` no Easypanel!** 🚀
