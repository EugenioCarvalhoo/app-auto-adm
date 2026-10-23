> **Desatualizado:** este guia histórico cita `node server.js`/Nixpacks, que não existem mais. O deploy atual usa Docker: veja [docs/DEPLOY-DOCKER.md](docs/DEPLOY-DOCKER.md).

# 🔧 Corrigir Proxy/Domínio no Easypanel

A API funciona localmente, então o problema é na configuração do proxy/domínio.

---

## ✅ CONFIRMAÇÃO

Se `curl localhost:5000/health` funciona no terminal:
- ✅ Backend está funcionando
- ✅ Rota `/health` existe
- ❌ Problema é no **proxy/domínio** ou **health check**

---

## 🔧 SOLUÇÕES

### Solução 1: Verificar Configuração do Domínio

**No Easypanel**:

1. **Serviço backend** → **Settings** → **Domains**

2. **Verifique**:
   - **Port**: Deve ser `5000` (mesma porta do backend)
   - **Protocol**: `HTTP` ou `HTTPS`
   - **Domain**: Está correto?

3. **Se estiver errado**, corrija para `5000`

---

### Solução 2: Verificar Health Check

**O health check pode estar falhando e encerrando o container**:

1. **Settings** → **Health Check**

2. **Configure ou desabilite**:
   - **Path**: `/health`
   - **Port**: `5000`
   - **Timeout**: `60` segundos (ou desabilite temporariamente)
   - **Interval**: `30` segundos

3. **Ou desabilite temporariamente** para testar

---

### Solução 3: Verificar Porta Target

1. **Settings** → **Ports**

2. **Verifique**:
   - **Target Port**: `5000`
   - **Published Port**: Pode ficar em branco (proxy faz isso)

---

### Solução 4: Verificar Comando de Start

**Certifique-se que o comando está correto**:

1. **Settings** → **General** ou **Start Command**

2. **Deve ser**:
   - `npm run start` ou
   - `node server.js`

3. **NÃO deve ser**: `npm start` (sem `run`)

---

## 🎯 TESTE PASSO A PASSO

### 1. Desabilitar Health Check (Temporário)

**Para isolar o problema**:

1. **Settings** → **Health Check**
2. **Desabilite** o health check
3. **Reinicie** o serviço
4. **Teste** no navegador: `https://multi-app-financialmanagementapp.dtun51.easypanel.host/health`

**Se funcionar**: O problema é o health check - configure-o depois.

**Se não funcionar**: Continue para próximo passo.

---

### 2. Verificar Porta no Domínio

1. **Settings** → **Domains**
2. **Confirme** que a porta está como `5000`
3. **Salve** e **reinicie**

---

### 3. Verificar Logs Completos

**Procure por**:
- Mensagens de erro do proxy
- Timeout errors
- Connection refused

---

## 🔍 DIAGNÓSTICO

### Se funcionar localmente mas não pelo proxy:

**Possíveis causas**:

1. **Porta errada no domínio** - Verifique se é `5000`
2. **Health check falhando** - Desabilite para testar
3. **Proxy não consegue conectar** - Verifique porta target
4. **Backend crashando após health check** - Aumente timeout

---

## ✅ CHECKLIST

- [ ] Domínio configurado com **Port: 5000**?
- [ ] Health check **desabilitado** (para teste)?
- [ ] Target Port é `5000`?
- [ ] Serviço **reiniciado** após mudanças?
- [ ] Testou `curl localhost:5000/health` no terminal? ✅ (já confirmado)

---

## 🚀 AÇÃO IMEDIATA

**Comece por aqui**:

1. **Desabilite health check** temporariamente
2. **Reinicie serviço**
3. **Teste no navegador**: `https://multi-app-financialmanagementapp.dtun51.easypanel.host/health`

**Se funcionar**: Configure o health check corretamente depois.
**Se não funcionar**: Verifique a porta no domínio.

---

## 💡 DICA

Como funciona localmente, o backend está correto. O problema é **sempre** na configuração do Easypanel (proxy/domínio/health check).

**Foque em corrigir essas configurações!** 🎯
