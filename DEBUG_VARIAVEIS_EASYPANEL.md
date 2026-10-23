# 🔍 Debug: Variáveis de Ambiente não Estão Sendo Lidas

Guia para diagnosticar por que as variáveis não estão sendo carregadas corretamente.

---

## 🔍 PROBLEMA IDENTIFICADO

Os logs mostram:
```
❌ erro ao conectar ao banco de dados: error: connect ECONNREFUSED 127.0.0.1:5432
✅ conectado ao postgresql: 2026-01-18
```

**Primeiro tenta `127.0.0.1:5432` (default), depois conecta** - indica que variáveis não estão sendo lidas inicialmente.

---

## ✅ ADICIONEI LOGS DE DEBUG

Adicionei logs no código para verificar se as variáveis estão sendo lidas:

```javascript
console.log('🔍 Configuração do Banco:');
console.log('  DB_HOST:', process.env.DB_HOST || '(não definido)');
console.log('  DB_PORT:', process.env.DB_PORT || '(não definido)');
```

---

## 📋 PRÓXIMOS PASSOS

### 1. Fazer Commit e Push

```bash
git add backend/server.js
git commit -m "Adicionar logs de debug para variáveis de ambiente"
git push
```

### 2. Aguardar Redeploy no Easypanel

O Easypanel deve fazer redeploy automaticamente.

### 3. Verificar Logs

Nos logs do backend, procure por:

```
🔍 Configuração do Banco:
  DB_HOST: easypanel.carvalhosolutions.com.br
  DB_PORT: 5433
  ...
```

**Se mostrar `(não definido)`, as variáveis não estão sendo injetadas!**

---

## 🔧 POSSÍVEIS CAUSAS

### Causa 1: Variáveis Não Estão Salvas

**Verifique**:
1. No Easypanel, as variáveis estão **salvas**?
2. Após adicionar, você clicou em **"Save"** ou **"Apply"**?

### Causa 2: Formato das Variáveis

**No Easypanel**, certifique-se de que está assim:

```
NODE_ENV=production
PORT=5000
DB_HOST=easypanel.carvalhosolutions.com.br
DB_PORT=5433
DB_NAME=financialmanagement-01
DB_USER=financialmanagement01
DB_PASSWORD=7311a932d0f130b53bcf
JWT_SECRET=financialmanagement01_carvalho_solutions
```

**Uma variável por linha, sem espaços extras!**

### Causa 3: Reiniciar Serviço

**Após configurar variáveis**:
1. **Reinicie** o serviço backend
2. Variáveis só são aplicadas após reiniciar

### Causa 4: Arquivo .env Interferindo

O código usa `dotenv.config()` que pode tentar carregar arquivo `.env`.

**Solução**: Em produção, o Easypanel injeta variáveis diretamente no `process.env`, então o `dotenv` não deve interferir. Mas se houver arquivo `.env` com valores errados, pode sobrescrever.

---

## 🎯 DIAGNÓSTICO

### Após redeploy, verifique os logs:

**Se os logs mostrarem**:
```
🔍 Configuração do Banco:
  DB_HOST: (não definido)
  DB_PORT: (não definido)
```

**Problema**: Variáveis não estão sendo injetadas pelo Easypanel.

**Solução**:
1. Verifique se variáveis estão salvas
2. Reinicie serviço
3. Verifique formato (uma por linha)

---

**Se os logs mostrarem**:
```
🔍 Configuração do Banco:
  DB_HOST: easypanel.carvalhosolutions.com.br
  DB_PORT: 5433
```

**Mas ainda der erro de conexão**:
- Problema é de rede/conectividade, não variáveis
- Verifique firewall, credenciais, etc.

---

## 📊 VERIFICAÇÃO MANUAL NO TERMINAL

**No terminal do backend no Easypanel**:

```bash
# Ver todas as variáveis
env | grep DB_

# Ver variável específica
echo $DB_HOST
echo $DB_PORT
```

**Se não aparecer nada ou mostrar vazio**: Variáveis não estão configuradas!

---

## ✅ CHECKLIST

- [ ] Variáveis estão **salvas** no Easypanel?
- [ ] Formato está **correto** (uma por linha, sem espaços)?
- [ ] Serviço foi **reiniciado** após configurar variáveis?
- [ ] Logs mostram valores corretos ou `(não definido)`?

---

**Faça o commit e push, depois verifique os logs!** 🚀
