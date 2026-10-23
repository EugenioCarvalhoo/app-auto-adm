# 🔧 Corrigir 502 Bad Gateway - Problema no Proxy

O servidor está rodando corretamente! O problema é na configuração do proxy/domínio.

---

## ✅ SUCESSO PARCIAL

**O que funciona**:
- ✅ Servidor rodando na porta 5000
- ✅ Conectado ao PostgreSQL
- ✅ Sem SIGTERM
- ✅ Funciona localmente (`curl localhost:5000/health`)

**O que não funciona**:
- ❌ Acesso via domínio retorna 502 Bad Gateway

---

## 🔍 PROBLEMA

**502 Bad Gateway** = O proxy não consegue conectar ao backend.

**Possíveis causas**:
1. Porta errada no domínio
2. Backend não está escutando em `0.0.0.0`
3. Proxy não está configurado corretamente

---

## ✅ SOLUÇÕES

### Solução 1: Verificar Porta no Domínio

**No Easypanel**:

1. **Serviço backend** → **Settings** → **Domains**
2. **Verifique a porta**:
   - Deve ser: `5000`
   - **NÃO deve ser**: `3000`, `8080`, ou outra porta

3. **Se estiver errada**, corrija para `5000`

4. **Salve** e **reinicie** o serviço

---

### Solução 2: Verificar se Backend Escuta em 0.0.0.0

**Já verificamos**: O código está correto:
```javascript
app.listen(PORT, '0.0.0.0', () => {
```

✅ Isso está correto!

---

### Solução 3: Verificar Target Port (Se Existir)

1. **Settings** → **Ports** (se existir essa opção)
2. **Target Port**: Deve ser `5000`

---

### Solução 4: Verificar URL do Domínio

**Confirme que o domínio está correto**:
- `https://multi-app-financialmanagementapp.dtun51.easypanel.host`

**Teste no terminal do backend**:

```bash
# Ver se está escutando corretamente
netstat -tulpn | grep 5000

# Testar localmente
curl http://localhost:5000/health
```

---

## 🎯 AÇÃO IMEDIATA

### Passo 1: Verificar Porta no Domínio

1. **Settings** → **Domains**
2. **Confirme que Port = 5000**
3. **Se não for**, mude para `5000`
4. **Salve** e **Reinicie**

### Passo 2: Testar Novamente

Após reiniciar, teste:
```
https://multi-app-financialmanagementapp.dtun51.easypanel.host/health
```

---

## 🔍 DIAGNÓSTICO AVANÇADO

### Se ainda der 502 após corrigir porta:

**No terminal do backend**, teste:

```bash
# Ver processos
ps aux | grep node

# Ver porta
ss -tulpn | grep 5000

# Teste local
curl -v http://localhost:5000/health
```

**Se `curl localhost:5000/health` funcionar**, o problema é 100% no proxy/domínio.

---

## 💡 O QUE VERIFICAR

**Na configuração do Domínio**:

- [ ] **Port**: `5000` (mesmo da variável PORT)
- [ ] **Protocol**: `HTTP` ou `HTTPS`
- [ ] **Domain**: Está correto?

**Após salvar**, o proxy deve conseguir conectar.

---

## 📋 CHECKLIST

- [ ] Domínio está com **Port: 5000**?
- [ ] Serviço foi **reiniciado** após corrigir porta?
- [ ] `curl localhost:5000/health` funciona? ✅ (já confirmado)
- [ ] Acesso via domínio ainda dá 502?

---

## 🚀 PRÓXIMO PASSO

**Verifique a porta no domínio**:
1. **Settings** → **Domains**
2. **Port**: Deve ser `5000`
3. **Salve** e **Reinicie**

**Me diga qual porta está configurada no domínio!** 🎯
