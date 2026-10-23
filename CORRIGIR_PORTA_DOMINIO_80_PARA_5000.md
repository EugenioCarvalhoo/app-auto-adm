# 🔧 Corrigir Porta do Domínio: 80 → 5000

O domínio está redirecionando para porta `80`, mas o backend está na porta `5000`!

---

## 🔍 PROBLEMA IDENTIFICADO

**Configuração atual**:
```
https://multi-app-financialmanagementapp.dtun51.easypanel.host/
→ http://multi-app_financialmanagementapp:80/
```

**Mas o backend está rodando na porta `5000`!**

---

## ✅ SOLUÇÃO

### Alterar a Porta no Domínio

**No Easypanel**:

1. **Settings** → **Domains**
2. **Encontre o domínio**: `https://multi-app-financialmanagementapp.dtun51.easypanel.host/`
3. **Altere o target** de:
   ```
   http://multi-app_financialmanagementapp:80/
   ```
   
   **Para**:
   ```
   http://multi-app_financialmanagementapp:5000/
   ```
   
   **Ou** se houver um campo **"Port"** separado:
   - Mude de `80` para `5000`

4. **Salve** as alterações

5. **Reinicie** o serviço backend

---

## 🎯 CONFIGURAÇÃO CORRETA

**Deve ficar assim**:

```
https://multi-app-financialmanagementapp.dtun51.easypanel.host/
→ http://multi-app_financialmanagementapp:5000/
```

**Ou**:

- **Domain**: `multi-app-financialmanagementapp.dtun51.easypanel.host`
- **Target**: `multi-app_financialmanagementapp` (ou nome do serviço)
- **Port**: `5000` (não 80!)

---

## 📋 ONDE ENCONTRAR A CONFIGURAÇÃO

**Na aba Domains**, você pode ter:

### Opção 1: Campo "Port" separado
- **Port**: Mude de `80` para `5000`

### Opção 2: URL completa no target
- **Target**: Mude de `http://...:80/` para `http://...:5000/`

### Opção 3: Campos separados
- **Service/Container**: `multi-app_financialmanagementapp`
- **Port**: `5000` (mude de 80)

---

## ✅ APÓS CORRIGIR

1. **Salve** as mudanças
2. **Reinicie** o serviço backend
3. **Teste**: `https://multi-app-financialmanagementapp.dtun51.easypanel.host/health`

**Deve funcionar agora!** 🎉

---

## 🔍 VERIFICAÇÃO

Após corrigir, teste:

```bash
curl https://multi-app-financialmanagementapp.dtun51.easypanel.host/health
```

**Resposta esperada**:
```json
{
  "status": "ok",
  "database": "connected",
  "timestamp": "2026-01-18T..."
}
```

---

## 💡 RESUMO

**Antes**:
- Proxy → Porta `80` → Backend não está lá! → 502

**Depois**:
- Proxy → Porta `5000` → Backend está lá! → ✅ Funciona

**Mude a porta de 80 para 5000!** 🚀
