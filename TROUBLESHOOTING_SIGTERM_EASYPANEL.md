> **Desatualizado:** este guia histórico cita `node server.js`/Nixpacks, que não existem mais. O deploy atual usa Docker: veja [docs/DEPLOY-DOCKER.md](docs/DEPLOY-DOCKER.md).

# 🔧 Troubleshooting: Erro SIGTERM no Easypanel

Guia para resolver o problema de encerramento do servidor após iniciar.

---

## 🔍 PROBLEMA IDENTIFICADO

Os logs mostram:
```
✅ servidor rodando na porta 5000
✅ conectado ao postgresql
❌ npm error path/app
❌ npm error command failed
❌ npm error signal sigterm
```

O servidor **inicia corretamente** mas é **encerrado** logo depois.

---

## 🔎 POSSÍVEIS CAUSAS

### 1. **Healthcheck Falhando** ⚠️ (Mais Provável)

O Easypanel pode estar verificando se o serviço está respondendo e, se não encontrar resposta, encerra o container.

### 2. **Porta Não Exposta Corretamente**

A porta 5000 pode não estar configurada para ser acessível externamente.

### 3. **Timeout de Inicialização**

O Easypanel pode ter um timeout e, se o serviço não responder a tempo, encerra.

---

## ✅ SOLUÇÕES

### Solução 1: Configurar Healthcheck no Easypanel

1. **No serviço backend**, vá em **Settings** → **Health Check** (ou similar)

2. **Configure**:
   - **Path**: `/` ou deixe vazio
   - **Port**: `5000`
   - **Timeout**: `30` segundos
   - **Interval**: `10` segundos
   - **Retries**: `3`

3. **Salve** e reinicie

### Solução 2: Adicionar Rota de Health Check

Vou adicionar uma rota `/health` no backend:

```javascript
// Adicionar antes do app.listen()
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});
```

### Solução 3: Verificar Configuração de Porta

1. **No serviço backend**, vá em **Settings** → **Networking** ou **Ports**

2. **Verifique**:
   - Porta **5000** está configurada e **exposta**
   - O **protocolo** está como **HTTP** (não HTTPS se não tiver SSL)

### Solução 4: Verificar Comando de Inicialização

No Easypanel, verifique se o **comando de start** está correto:
- Deve ser: `npm run start` ou `node server.js`
- **NÃO deve ser**: `npm start` (sem o `run`)

---

## 🛠️ IMPLEMENTAÇÃO: Adicionar Health Check Route

Vou adicionar uma rota `/health` no servidor para o Easypanel verificar se está funcionando:

### Como fazer:

1. Adicione esta rota no `server.js` (antes do `app.listen()`):

```javascript
// Health check endpoint
app.get('/health', async (req, res) => {
  try {
    // Testar conexão com banco
    await pool.query('SELECT 1');
    res.status(200).json({ 
      status: 'ok', 
      database: 'connected',
      timestamp: new Date().toISOString() 
    });
  } catch (error) {
    res.status(503).json({ 
      status: 'error', 
      database: 'disconnected',
      error: error.message 
    });
  }
});
```

2. Isso permite que o Easypanel verifique se o serviço está realmente funcionando.

---

## 📋 CHECKLIST DE VERIFICAÇÃO

Verifique no Easypanel:

- [ ] **Porta 5000** está configurada e exposta externamente
- [ ] **Health Check** está configurado (ou desabilitado temporariamente para teste)
- [ ] **Comando de start** está correto (`npm run start` ou `node server.js`)
- [ ] **Variáveis de ambiente** estão todas configuradas
- [ ] **PostgreSQL** está acessível (host e porta corretos)

---

## 🔍 DEBUG: Verificar Logs Completos

1. **Acesse os logs completos** do serviço no Easypanel
2. **Procure por**:
   - Mensagens de erro antes do SIGTERM
   - Health check failures
   - Timeout warnings
   - Port binding errors

---

## 💡 AÇÃO IMEDIATA

### Passo 1: Desabilitar Health Check (Temporário)

Se houver opção de **desabilitar health check** temporariamente:
1. Desabilite
2. Reinicie o serviço
3. Veja se continua rodando

Se funcionar, o problema é o health check. Configure-o corretamente.

### Passo 2: Adicionar Rota /health

Adicione a rota `/health` no código (como mostrado acima) para o health check funcionar.

### Passo 3: Verificar Porta

Confirme que a porta 5000 está configurada corretamente nas configurações de rede.

---

## 📞 SE NADA FUNCIONAR

1. **Verifique os logs completos** no Easypanel (não apenas os últimos)
2. **Confira se há** mensagens de erro específicas antes do SIGTERM
3. **Teste localmente** se o servidor funciona normalmente
4. **Verifique se** o PostgreSQL está realmente acessível da rede do backend

---

## ✅ VERIFICAÇÃO FINAL

Após aplicar as correções, o servidor deve:

- ✅ Iniciar e permanecer rodando
- ✅ Responder a requisições HTTP na porta 5000
- ✅ Responder ao `/health` com status 200
- ✅ Não receber SIGTERM inesperado

Se os logs mostrarem apenas "Servidor rodando na porta 5000" sem erros seguintes, está funcionando! 🎉
