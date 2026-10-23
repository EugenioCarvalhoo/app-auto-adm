# 🔧 Troubleshooting: Erro 502 Bad Gateway

Guia para resolver o erro 502 ao acessar o backend.

---

## 🔍 PROBLEMA

Erro **502 Bad Gateway** ao acessar:
- `https://multi-app-financialmanagementapp.dtun51.easypanel.host/health`

Isso significa: **O proxy consegue acessar, mas o backend não está respondendo.**

---

## ✅ VERIFICAÇÕES IMEDIATAS

### 1. Verificar Logs do Backend

**Ação**:
1. No Easypanel, vá em **Logs** do serviço backend
2. Procure por:
   - ✅ `Servidor rodando na porta 5000` (está rodando?)
   - ✅ `Conectado ao PostgreSQL` (conectou ao banco?)
   - ❌ Mensagens de erro
   - ❌ `SIGTERM` ou `crash`

**Se não houver logs ou o serviço não iniciou**:
- Verifique se há erros nas variáveis de ambiente
- Confirme que todas as variáveis estão corretas

---

### 2. Verificar Configuração do Domínio

**Ação**:
1. **Settings** → **Domains**
2. Confirme:
   - **Port**: `5000` (mesma porta que o backend escuta)
   - **Protocol**: `HTTP` ou `HTTPS`

**Se estiver diferente de 5000**, corrija!

---

### 3. Verificar Variável PORT

**Ação**:
1. **Settings** → **Environment Variables**
2. Confirme que existe:
   ```
   PORT=5000
   ```

**Se não existir ou estiver diferente**, adicione/corrija!

---

### 4. Verificar Porta Target (se configurada)

**Ação**:
1. **Settings** → **Ports**
2. Se houver configuração de porta:
   - **Target Port**: Deve ser `5000`
   - **Published Port**: Pode ficar em branco

---

## 🔧 SOLUÇÕES

### Solução 1: Verificar se Backend Está Rodando

**Se os logs mostrarem que o backend crashou**:

1. **Verifique erros nos logs** (ex: erro de conexão com banco)
2. **Corrija o problema** (ex: variáveis de ambiente incorretas)
3. **Reinicie o serviço**

---

### Solução 2: Verificar Conexão com PostgreSQL

**Se o erro for de conexão com banco**:

1. **Verifique variáveis de ambiente do banco**:
   - `DB_HOST` está correto?
   - `DB_PORT` está correto?
   - `DB_PASSWORD` está correto?

2. **Teste a conexão** do PostgreSQL:
   - Certifique-se que está acessível
   - Verifique se a porta externa está correta

---

### Solução 3: Verificar se Backend Escuta na Porta Correta

**No código, o backend deve escutar em `0.0.0.0:5000`**:

Verifique no `server.js`:
```javascript
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
```

**Se não tiver `'0.0.0.0'`**, adicione! Isso permite conexões externas.

---

### Solução 4: Reiniciar Serviço

**Após corrigir qualquer configuração**:

1. **Reinicie o serviço backend** no Easypanel
2. **Aguarde alguns segundos** para iniciar
3. **Verifique os logs** novamente

---

## 📋 CHECKLIST DE DIAGNÓSTICO

Execute este checklist:

### Backend:
- [ ] Serviço backend está **rodando** (não crashou)?
- [ ] Logs mostram `Servidor rodando na porta 5000`?
- [ ] Logs mostram `Conectado ao PostgreSQL`?
- [ ] **Não há erros** nos logs?

### Configuração:
- [ ] Variável `PORT=5000` está configurada?
- [ ] Domínio está configurado com **Port: 5000**?
- [ ] `DB_HOST`, `DB_PORT`, `DB_PASSWORD` estão corretos?

### Código:
- [ ] Backend escuta em `0.0.0.0` (não `localhost`)?

---

## 🔍 DIAGNÓSTICO DETALHADO

### Se os logs mostram que iniciou mas depois crashou:

**Possível causa**: Erro após iniciar (ex: erro em rota, problema com banco)

**Solução**:
1. Veja os **logs completos** (não apenas últimos)
2. Procure por **stack traces** ou mensagens de erro
3. Corrija o erro específico

---

### Se os logs não mostram nada ou serviço não inicia:

**Possível causa**: Erro na inicialização (ex: variáveis faltando)

**Solução**:
1. Verifique **todas as variáveis de ambiente** obrigatórias
2. Confirme que não há erros de sintaxe nas variáveis
3. Reinicie o serviço

---

### Se os logs mostram conexão recusada ao banco:

**Possível causa**: PostgreSQL não acessível ou credenciais erradas

**Solução**:
1. Verifique `DB_HOST` (deve ser host externo, não `localhost`)
2. Verifique `DB_PORT` (deve ser porta externa do PostgreSQL)
3. Verifique `DB_PASSWORD` (senha correta)
4. Teste conexão manual ao PostgreSQL se possível

---

## 🎯 AÇÃO IMEDIATA

**Execute na ordem**:

1. **Verifique logs** do backend - o que mostram?
2. **Verifique variável `PORT=5000`** está configurada?
3. **Verifique domínio** está apontando para porta `5000`?
4. **Verifique conexão com banco** - variáveis corretas?
5. **Reinicie serviço** após correções

---

## 📞 SE NADA FUNCIONAR

**Envie informações**:

1. **Logs completos** do backend (últimas 50 linhas)
2. **Variáveis de ambiente** configuradas (sem senhas)
3. **Configuração do domínio** (porta configurada)
4. **Status do serviço** (rodando/crashado)

Com essas informações, posso ajudar a identificar o problema específico!

---

## ✅ RESULTADO ESPERADO

Após corrigir, você deve ver:

**Nos logs**:
```
✅ Servidor rodando na porta 5000
✅ Conectado ao PostgreSQL: ...
```

**No navegador (curl)**:
```bash
curl https://multi-app-financialmanagementapp.dtun51.easypanel.host/health
```

**Resposta**:
```json
{
  "status": "ok",
  "database": "connected",
  "timestamp": "2026-01-18T..."
}
```

🎉 **502 resolvido!**
