> **Desatualizado:** este guia histórico cita `node server.js`/Nixpacks, que não existem mais. O deploy atual usa Docker: veja [docs/DEPLOY-DOCKER.md](docs/DEPLOY-DOCKER.md).

# 🔧 Solução Definitiva para SIGTERM no Easypanel

O problema persiste: o backend inicia, conecta ao banco, mas recebe SIGTERM imediatamente.

---

## 🔍 DIAGNÓSTICO

Os logs mostram:
```
✅ Configuração do Banco: OK
✅ Servidor rodando na porta 5000
✅ Conectado ao PostgreSQL
❌ SIGTERM (serviço encerrado)
```

**Isso indica**: O Easypanel está encerrando o container porque acha que não está funcionando.

---

## ✅ SOLUÇÕES

### Solução 1: Desabilitar Health Check Temporariamente

**Para testar se é o health check causando o problema**:

1. **No Easypanel**, vá no serviço backend
2. **Settings** → **Health Check** (ou **Health**)
3. **Desabilite** o health check temporariamente
4. **Reinicie** o serviço
5. **Veja se continua rodando**

Se funcionar, o problema é o health check. Configure-o corretamente depois.

---

### Solução 2: Verificar Comando de Start

**Verifique se o comando de inicialização está correto**:

1. **Settings** → **General** ou **Start Command**
2. Deve ser: `npm run start` ou `node server.js`
3. **Não deve ser**: `npm start` (sem `run`)

---

### Solução 3: Verificar se o Código Foi Deployado

**Certifique-se que o commit foi feito e o deploy aconteceu**:

```bash
# Verificar status
git status

# Se houver mudanças não commitadas
git add backend/server.js
git commit -m "Adicionar rota /health"
git push

# Aguardar deploy automático no Easypanel
```

**Verifique nos logs** se a rota `/health` está disponível (tente acessar no navegador após deploy).

---

### Solução 4: Adicionar Rota Raiz (/) Também

**Alguns sistemas verificam a rota raiz**:

Adicione no `server.js` (antes do `/health`):

```javascript
// Rota raiz para health check
app.get('/', (req, res) => {
  res.status(200).json({ 
    status: 'ok',
    message: 'Backend is running',
    timestamp: new Date().toISOString() 
  });
});
```

---

### Solução 5: Verificar Timeout de Inicialização

**O Easypanel pode ter timeout muito curto**:

1. **Settings** → **Health Check**
2. Aumente o **Timeout** para `60` segundos ou mais
3. Aumente o **Interval** para `30` segundos

---

## 🎯 AÇÃO IMEDIATA

### Passo 1: Verificar Git

```bash
git status
```

Se houver mudanças, faça commit e push.

### Passo 2: Desabilitar Health Check (Temporário)

No Easypanel, desabilite o health check para testar.

### Passo 3: Reiniciar Serviço

Reinicie o backend e monitore os logs.

### Passo 4: Testar Manualmente

Após reiniciar, teste:
```
https://multi-app-financialmanagementapp.dtun51.easypanel.host/health
```

---

## 🔍 VERIFICAÇÃO ADICIONAL

### Testar se o Servidor Está Escutando (No Terminal)

No terminal do backend no Easypanel:

```bash
# Ver se porta 5000 está escutando
netstat -tulpn | grep 5000

# Ou
ss -tulpn | grep 5000

# Testar localmente
curl http://localhost:5000/health
```

**Se `curl localhost:5000/health` funcionar**, o problema é no proxy/domínio.
**Se não funcionar**, o problema é no código/servidor.

---

## 📊 CHECKLIST COMPLETO

- [ ] Código commitado e push feito?
- [ ] Deploy aconteceu no Easypanel?
- [ ] Health check desabilitado (para teste)?
- [ ] Comando de start correto?
- [ ] Rota `/health` existe no código?
- [ ] Serviço reiniciado após mudanças?
- [ ] Logs não mostram mais SIGTERM?

---

## 💡 INSIGHT IMPORTANTE

**O problema pode ser**:
1. **Health check configurado mas falhando** - desabilite temporariamente
2. **Código não foi deployado** - faça commit e push
3. **Timeout muito curto** - aumente timeout do health check
4. **Comando de start errado** - verifique se é `npm run start`

**Comece desabilitando o health check para isolar o problema!**

---

## 🚀 PRÓXIMO PASSO

1. **Desabilite health check** no Easypanel (temporário)
2. **Reinicie serviço**
3. **Veja se continua rodando**
4. Se funcionar, o problema é o health check - configure-o depois
5. Se não funcionar, verifique commit/deploy do código
