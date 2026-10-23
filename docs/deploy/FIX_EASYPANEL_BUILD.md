> **Desatualizado:** este guia histórico cita `node server.js`/Nixpacks, que não existem mais. O deploy atual usa Docker: veja [docs/DEPLOY-DOCKER.md](../DEPLOY-DOCKER.md).

# 🔧 Correção: Erro de Build no Easypanel

## ❌ Problema

O Nixpacks não consegue detectar o projeto Node.js porque o `package.json` está na raiz, mas o build está configurado para `/backend`.

**Erro**: `Nixpacks was unable to generate a build plan for this app`

## ✅ Solução

### Opção 1: Criar package.json no backend (Recomendado) ⭐

Já criado! O arquivo `backend/package.json` foi criado com as dependências necessárias.

**Agora você precisa:**

1. **Commitar e fazer push do novo arquivo**:
   ```bash
   git add backend/package.json
   git commit -m "Adicionar package.json no backend para deploy Easypanel"
   git push origin main
   ```

2. **No Easypanel, faça um novo deploy** (ou o Easypanel pode detectar automaticamente)

### Opção 2: Usar Dockerfile (Alternativa)

Se o problema persistir, o Easypanel pode usar o `Dockerfile` que já existe.

**No Easypanel:**

1. **Settings do serviço** → **Build**
2. **Build Method**: Selecione **"Dockerfile"** em vez de **"Auto-detect"**
3. **Dockerfile Path**: `backend/Dockerfile`

### Opção 3: Mudar Caminho de Build para Raiz

Se preferir manter tudo na raiz:

1. **Settings do serviço** → **Source**
2. **Caminho de Build**: mude de `/backend` para `/` (raiz)
3. **Start Command**: mude para `cd backend && node server.js`
   - Ou: `node backend/server.js` (se o NODE_PATH permitir)

---

## 📋 Verificação

Após adicionar o `package.json` no backend, verifique:

✅ Arquivo existe: `backend/package.json`  
✅ Contém `"main": "server.js"`  
✅ Contém script `"start": "node server.js"`  
✅ Contém todas as dependências (express, pg, cors, etc.)  
✅ Arquivo commitado e pushado para GitHub  
✅ Novo deploy iniciado no Easypanel  

---

## 🔍 Estrutura Esperada

```
backend/
├── package.json      ← NOVO! Necessário para o Nixpacks detectar
├── server.js
├── Dockerfile
├── env.example
├── database/
└── middleware/
```

---

## 🆘 Se o erro persistir

### Verifique os logs do build no Easypanel:
- Veja se encontra `package.json`
- Verifique se o caminho está correto
- Confirme que o arquivo foi commitado

### Alternativas:

1. **Use Dockerfile explicitamente**:
   - Build Method: Dockerfile
   - Dockerfile Path: `backend/Dockerfile`

2. **Verifique o Caminho de Build**:
   - Deve ser `/backend` se o `package.json` está em `backend/`
   - Ou `/` se mudou a estratégia

---

## ✅ Próximos Passos

1. ✅ `backend/package.json` criado
2. ⬜ Commit e push do arquivo
3. ⬜ Novo deploy no Easypanel
4. ⬜ Verificar logs do build
5. ⬜ Confirmar que o servidor inicia corretamente

**Depois do commit, faça push e tente o deploy novamente!** 🚀
