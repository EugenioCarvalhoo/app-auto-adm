> **Desatualizado:** este guia histórico cita `node server.js`/Nixpacks, que não existem mais. O deploy atual usa Docker: veja [docs/DEPLOY-DOCKER.md](docs/DEPLOY-DOCKER.md).

# ⚙️ Configurar Comando de Início no Easypanel

Você está usando **Nixpacks** para build. Precisamos configurar o **Comando de Início**.

---

## ✅ SOLUÇÃO

### 1. Configurar Comando de Início

**Na aba "Fonte"**, no campo **"Comando de Início"**:

**Digite**:
```
node server.js
```

**Ou**:
```
npm run start
```

**⚠️ IMPORTANTE**: O comando deve estar **vazio ou correto**. Se estiver vazio, o Nixpacks tenta detectar automaticamente, mas pode não funcionar.

---

## 🔧 OPÇÕES

### Opção 1: Usar Comando de Início

**Na aba "Fonte"** → **"Comando de Início"**:
```
node server.js
```

**Vantagem**: Simples, direto.

---

### Opção 2: Mudar para Dockerfile

**Se o comando de início não funcionar**, mude a construção:

1. **Na aba "Fonte"** → **"Construção"**
2. **Mude de "Nixpacks" para "Dockerfile"**
3. O Dockerfile já está configurado corretamente!

**Vantagem**: Mais controle, menos problemas.

---

## 📋 CHECKLIST

- [ ] **Comando de Início** está configurado como `node server.js`?
- [ ] Ou mudou para **Dockerfile**?
- [ ] Serviço **reiniciado** após mudanças?
- [ ] Logs mostram servidor rodando sem SIGTERM?

---

## 🎯 RECOMENDAÇÃO

**Configure o "Comando de Início"**:

1. **Aba "Fonte"**
2. **Campo "Comando de Início"**
3. **Digite**: `node server.js`
4. **Salve** e **reinicie**

**Ou mude para Dockerfile** (mais confiável).

---

## 💡 O QUE FAZER AGORA

**Escolha uma opção**:

**Opção A - Configurar Comando**:
- Aba "Fonte" → "Comando de Início" → `node server.js`
- Salve e reinicie

**Opção B - Usar Dockerfile**:
- Aba "Fonte" → "Construção" → Mude para "Dockerfile"
- Salve e reinicie

**Recomendo começar pela Opção A** (mais simples). Se não funcionar, use a Opção B (Dockerfile).

---

**Teste e me diga o resultado!** 🚀
