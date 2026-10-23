# 🚀 Deploy do Frontend no Easypanel

Guia completo para hospedar o frontend React no Easypanel.

---

## 📋 PRÉ-REQUISITOS

✅ Backend já está funcionando no Easypanel
✅ URL do backend: `https://multi-app-financialmanagementapp.dtun51.easypanel.host`

---

## 🔧 CONFIGURAÇÃO

### Passo 1: Atualizar config.js do Frontend

O `config.js` já está configurado para usar variáveis de ambiente! Mas vamos garantir que funcione em produção.

**Já existe**: `REACT_APP_API_URL` - será configurado no Easypanel.

---

### Passo 2: Criar Dockerfile (Já Criado!)

O `Dockerfile` foi criado em `frontend/Dockerfile`. Ele:
- Faz build do React
- Serve arquivos estáticos com nginx
- Configurado para SPA (Single Page Application)

---

### Passo 3: Deploy no Easypanel

#### 3.1 Criar Novo Serviço

1. **No Easypanel**, crie um **novo serviço**
2. **Nome**: Ex: `frontend` ou `financial-management-frontend`
3. **Fonte**: **GitHub**
   - **Proprietário**: Seu usuário/organização
   - **Repositório**: `controlefinanceiro` (ou nome do repo)
   - **Branch**: `main` (ou sua branch)
   - **Caminho de Build**: `/frontend` ⚠️ **IMPORTANTE!**

#### 3.2 Configurar Build

1. **Aba "Fonte"**
2. **Construção**: Selecione **"Dockerfile"**
3. O Easypanel detectará automaticamente o `Dockerfile` em `/frontend`

#### 3.3 Configurar Variáveis de Ambiente

**Settings** → **Environment Variables**:

```env
REACT_APP_API_URL=https://multi-app-financialmanagementapp.dtun51.easypanel.host/api
```

⚠️ **IMPORTANTE**: 
- Use a URL completa do backend (incluindo `/api` no final)
- Use `https://` (o backend deve estar acessível via HTTPS)

#### 3.4 Configurar Domínio

1. **Settings** → **Domains**
2. **Adicione domínio**:
   - **Domain**: Ex: `app.seusite.com` ou use o domínio fornecido pelo Easypanel
   - **Port**: `80` (nginx escuta na porta 80)
   - **Protocol**: `HTTPS`

3. **Salve**

---

## 📋 CONFIGURAÇÃO DETALHADA

### Caminho de Build

**Muito importante**: Configure o **"Caminho de Build"** como `/frontend`

Isso diz ao Easypanel para:
- Baixar o repositório
- Entrar na pasta `frontend/`
- Procurar o `Dockerfile` lá

### Variável de Ambiente

```env
REACT_APP_API_URL=https://multi-app-financialmanagementapp.dtun51.easypanel.host/api
```

**Formato**: `https://DOMINIO_DO_BACKEND/api`

---

## ✅ VERIFICAÇÃO

### Após Deploy

1. **Acesse o domínio** configurado
2. **Verifique no navegador** (DevTools → Network):
   - Requisições devem ir para: `https://multi-app-financialmanagementapp.dtun51.easypanel.host/api/...`

### Testar

1. **Acesse**: `https://seu-dominio-frontend.easypanel.host`
2. **Faça login**
3. **Verifique** se consegue acessar o backend

---

## 🔧 TROUBLESHOOTING

### Erro: "Cannot connect to API"

**Solução**:
1. Verifique `REACT_APP_API_URL` está correto
2. Confirme que a URL termina com `/api`
3. Teste a URL do backend diretamente: `https://multi-app-financialmanagementapp.dtun51.easypanel.host/health`

### Erro: "404 Not Found" ao navegar

**Causa**: Nginx não está configurado para SPA.

**Solução**: O Dockerfile já está configurado para SPA (usa `try_files`). Se ainda der erro, verifique se o build foi feito corretamente.

### Erro no Build

**Solução**:
1. Verifique se `package.json` está em `/frontend`
2. Verifique se `Dockerfile` está em `/frontend`
3. Verifique logs do build no Easypanel

---

## 📊 ESTRUTURA DO PROJETO

```
controlefinanceiro/
├── backend/
│   ├── Dockerfile          ← Backend
│   └── ...
├── frontend/
│   ├── Dockerfile          ← Frontend (NOVO!)
│   ├── package.json
│   └── src/
│       └── config.js       ← Usa REACT_APP_API_URL
```

---

## 🎯 CHECKLIST

- [ ] Dockerfile criado em `frontend/Dockerfile` ✅
- [ ] Novo serviço criado no Easypanel
- [ ] Caminho de Build: `/frontend`
- [ ] Construção: `Dockerfile`
- [ ] Variável `REACT_APP_API_URL` configurada
- [ ] Domínio configurado (Port: 80)
- [ ] Deploy concluído
- [ ] Frontend acessível via domínio
- [ ] Login funciona (conecta ao backend)

---

## 🚀 PRÓXIMOS PASSOS

1. **Commit e push** do Dockerfile
2. **Criar serviço** no Easypanel
3. **Configurar** variáveis e domínio
4. **Aguardar deploy**
5. **Testar** acesso

**Pronto para começar!** 🎉
