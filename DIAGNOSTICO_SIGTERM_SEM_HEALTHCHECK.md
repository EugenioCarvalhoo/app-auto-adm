> **Desatualizado:** este guia histórico cita `node server.js`/Nixpacks, que não existem mais. O deploy atual usa Docker: veja [docs/DEPLOY-DOCKER.md](docs/DEPLOY-DOCKER.md).

# 🔍 Diagnóstico SIGTERM sem Health Check

Não há opção de Health Check no Easypanel. O problema pode ser outra coisa.

---

## 🔍 POSSÍVEIS CAUSAS

### 1. Comando de Inicialização Incorreto

**Verifique**:
1. **Settings** → **General** ou procure por **"Command"** ou **"Start Command"**
2. Deve ser:
   - `npm run start` ou
   - `node server.js`

**Se estiver como `npm start`**, mude para `npm run start`.

---

### 2. Processo Principal Terminando

**O container pode estar encerrando porque o processo principal termina**.

**Verifique os logs completos**:
- Há alguma mensagem de erro antes do SIGTERM?
- O processo node está realmente rodando?

---

### 3. Configuração de Porta

**Verifique**:
1. **Settings** → **Domains** ou **Proxy**
   - Port deve ser `5000`

2. **Settings** → **Ports** (se existir)
   - Target Port: `5000`

---

### 4. Verificar Se o Servidor Está Escutando Corretamente

**No terminal do backend**:

```bash
# Ver processos Node
ps aux | grep node

# Ver porta 5000
netstat -tulpn | grep 5000
# ou
ss -tulpn | grep 5000

# Testar localmente
curl http://localhost:5000/health
```

---

## 🎯 AÇÃO IMEDIATA

### 1. Verificar Comando de Start

**Procure por**:
- **Settings** → **Command**
- **Settings** → **Start Command**  
- **Settings** → **General** → **Command**

**Deve ser**: `npm run start` ou `node server.js`

---

### 2. Verificar Logs Completos

**Veja TODOS os logs, não apenas os últimos**:
- Há erros ANTES do "Servidor rodando"?
- Há warnings?
- O que acontece entre "conectado ao postgresql" e "SIGTERM"?

---

### 3. Verificar Configuração de Domínio

**Settings** → **Domains**:
- Port: `5000`?
- Protocol: `HTTP` ou `HTTPS`?

---

## 🔧 SOLUÇÃO ALTERNATIVA

### Se o npm está causando problemas:

**Mude o comando de start para**:

```
node server.js
```

**Ao invés de**:
```
npm run start
```

Isso evita problemas com o processo npm.

---

## 📋 CHECKLIST

- [ ] Comando de start está como `node server.js` ou `npm run start`?
- [ ] Domínio está com Port: `5000`?
- [ ] Logs completos foram verificados (não apenas últimos)?
- [ ] Testou `curl localhost:5000/health` no terminal? ✅

---

## 💡 ONDE ESTÁ O COMANDO DE START?

**Procure em**:
- **Settings** → **General**
- **Settings** → **Advanced**
- **Overview** (pode ter um campo de comando)
- Procure por campos como: **"Command"**, **"Start Command"**, **"CMD"**

**Me diga qual opção você encontra nas Settings!**
