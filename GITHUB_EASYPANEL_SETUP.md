> **Desatualizado:** este guia histórico cita `node server.js`/Nixpacks, que não existem mais. O deploy atual usa Docker: veja [docs/DEPLOY-DOCKER.md](docs/DEPLOY-DOCKER.md).

# 🔗 Conectar Repositório GitHub Privado ao Easypanel

Este guia mostra como autorizar o Easypanel a acessar seu repositório GitHub privado e fazer o deploy.

---

## 📋 Pré-requisitos

- ✅ Conta no GitHub
- ✅ Repositório criado (pode ser privado)
- ✅ Código commitado e enviado para o GitHub
- ✅ Conta no Easypanel criada

---

## 🚀 PASSO A PASSO COMPLETO

### PASSO 1: Verificar Repositório no GitHub (2 min)

1. **Acesse seu repositório no GitHub**
2. **Verifique se o código está commitado e pushado**:
   ```bash
   git status
   git add .
   git commit -m "Preparando para deploy no Easypanel"
   git push origin main  # ou master, dependendo da sua branch principal
   ```

3. **Confirme o nome do repositório** (ex: `usuario/controlefinanceiro`)

---

### PASSO 2: Autorizar Easypanel no GitHub (5 min)

#### 2.1. Via OAuth App (Recomendado - Mais Seguro)

1. **No painel do Easypanel, vá para criar um novo serviço**
   - Clique em **"New Service"** ou **"Add Service"**
   - Selecione **"App"** ou **"Node.js"**
   - Escolha **"GitHub"** como fonte

2. **O Easypanel irá redirecionar para o GitHub**
   - Você será direcionado para uma página de autorização do GitHub
   - Se não aparecer, procure por **"Connect GitHub"** ou **"Authorize Easypanel"**

3. **Autorizar Easypanel no GitHub**:
   - GitHub mostrará: *"Easypanel wants to access your repositories"*
   - **Opções de autorização**:
     - ✅ **"All repositories"** - Acesso a todos os repositórios (mais fácil)
     - ✅ **"Only select repositories"** - Acesso apenas aos repositórios que você escolher (mais seguro)
   - **Recomendação**: Selecione **"Only select repositories"** e marque apenas o repositório do projeto

4. **Clique em "Authorize Easypanel"** ou **"Instalar"**

5. **Permissões solicitadas** (o que o Easypanel pode fazer):
   - ✅ Ler conteúdo do repositório
   - ✅ Acessar webhooks
   - ✅ Ler metadados do repositório
   - Essas permissões são necessárias para o deploy automático

---

#### 2.2. Via GitHub App (Alternativa)

Se a opção acima não funcionar:

1. **Acesse**: https://github.com/settings/apps
2. **Procure por "Easypanel"** na lista de aplicativos instalados
3. **Clique em "Configure"** se já estiver instalado
4. **Ou instale o GitHub App do Easypanel**:
   - Vá para as configurações do Easypanel
   - Procure por "GitHub Integration" ou "Connect GitHub"
   - Siga o link para instalar o GitHub App

---

### PASSO 3: Selecionar Repositório no Easypanel (2 min)

1. **Após autorizar, volte para o Easypanel**
2. **Selecione o repositório**:
   - Uma lista de repositórios aparecerá
   - Se o repositório for privado, ele aparecerá na lista se você autorizou corretamente
   - **Procure pelo nome**: `seu-usuario/controlefinanceiro`
   - Se não aparecer, verifique se você autorizou o repositório no passo 2

3. **Selecione a branch**:
   - Geralmente `main` ou `master`
   - Ou a branch que você quiser usar para produção

4. **Configure o diretório**:
   - Se o backend está em uma subpasta `backend/`, configure:
     - **Root Directory**: `backend`
   - Se estiver na raiz, deixe vazio

---

### PASSO 4: Configurar Deploy no Easypanel (5 min)

1. **Configurações de Build**:
   - **Build Command**: Deixe vazio ou `npm install` (o Easypanel detecta automaticamente)
   - **Start Command**: `node server.js`
   - **Port**: `5000`

2. **Variáveis de Ambiente** (veja `DEPLOY_EASYPANEL.md` para detalhes):
   ```env
   NODE_ENV=production
   PORT=5000
   DB_HOST=seu-servidor.easypanel.io
   DB_PORT=5433
   DB_NAME=controle_financeiro
   DB_USER=postgres
   DB_PASSWORD=sua-senha
   JWT_SECRET=sua-chave-secreta
   ```

3. **Salvar e Deploy**:
   - Clique em **"Save"** ou **"Deploy"**
   - O Easypanel começará a fazer o clone do repositório
   - Você verá os logs do build em tempo real

---

## 🔍 Verificar se o Repositório Está Acessível

### Se o repositório NÃO aparecer na lista:

1. **Verifique as permissões no GitHub**:
   - Vá para: https://github.com/settings/installations
   - Encontre "Easypanel" na lista
   - Clique em "Configure"
   - Em "Repository access", verifique se seu repositório está selecionado

2. **Reautorize se necessário**:
   - Remova o acesso do Easypanel
   - Tente conectar novamente
   - Selecione o repositório específico

3. **Verifique se o repositório existe**:
   - Confirme que o repositório está no GitHub
   - Verifique se você tem permissão de acesso (se for de uma organização)

---

## 🔐 Configurar Acesso por Organização

Se o repositório estiver em uma **organização GitHub**:

1. **Administrador da organização precisa autorizar**:
   - O adm precisa ir em: Settings → Third-party access
   - Autorizar o Easypanel para a organização

2. **Ou use um Personal Access Token** (alternativa - veja abaixo)

---

## 🔑 Alternativa: Usar Personal Access Token

Se a autorização OAuth não funcionar, você pode usar um token:

### Criar Token no GitHub:

1. **GitHub → Settings → Developer settings → Personal access tokens → Tokens (classic)**
2. **Generate new token (classic)**
3. **Configure**:
   - **Note**: `Easypanel Deploy`
   - **Expiration**: Escolha um período (ex: 90 dias ou No expiration)
   - **Scopes**: Marque:
     - ✅ `repo` (Full control of private repositories)
     - ✅ `workflow` (se usar GitHub Actions)
4. **Generate token**
5. **COPIE O TOKEN** (você só verá uma vez!)

### Usar Token no Easypanel:

1. **No Easypanel, ao conectar GitHub**:
   - Procure por opção **"Use Personal Access Token"**
   - Cole o token copiado
   - Ou configure nas **Settings → Integrations → GitHub**

2. **Selecione o repositório** usando o token

---

## ✅ Checklist de Verificação

Antes de fazer o deploy, verifique:

- [ ] Código commitado e pushado para GitHub
- [ ] Repositório privado configurado no GitHub
- [ ] Easypanel autorizado no GitHub (Settings → Applications → Easypanel)
- [ ] Repositório selecionado nas permissões do Easypanel
- [ ] Repositório aparece na lista do Easypanel
- [ ] Branch correta selecionada (main/master)
- [ ] Root Directory configurado (se backend estiver em subpasta)
- [ ] Variáveis de ambiente configuradas
- [ ] Deploy iniciado com sucesso

---

## 🆘 Troubleshooting

### Erro: "Repository not found" ou "Access denied"

**Solução**:
1. Verifique se autorizou o Easypanel no GitHub
2. Confirme que o repositório está na lista de permissões
3. Se for organização, o adm precisa autorizar

### Erro: "Clone failed"

**Solução**:
1. Verifique se o repositório existe no GitHub
2. Confirme que você tem permissão de acesso
3. Teste clonando manualmente: `git clone https://github.com/usuario/repo.git`

### Repositório não aparece na lista

**Solução**:
1. Vá para GitHub Settings → Applications → Easypanel → Configure
2. Em "Repository access", selecione "Only select repositories"
3. Marque seu repositório e salve
4. Volte ao Easypanel e tente novamente

### Erro ao fazer deploy: "Cannot find module"

**Solução**:
1. Verifique se o **Root Directory** está correto (`backend`)
2. Confirme que o `package.json` está no diretório correto
3. Verifique os logs do build no Easypanel

---

## 📚 Referências

- [GitHub OAuth Apps Documentation](https://docs.github.com/en/apps/oauth-apps)
- [GitHub Personal Access Tokens](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/creating-a-personal-access-token)
- [Easypanel GitHub Integration](https://easypanel.io/docs) (consulte a documentação oficial)

---

## 🎯 Resumo Rápido

1. **Push código para GitHub** ✅
2. **No Easypanel → New Service → GitHub** ✅
3. **Autorizar Easypanel no GitHub** (selecionar repositório) ✅
4. **Selecionar repositório e branch** ✅
5. **Configurar Root Directory, variáveis e deploy** ✅

**Pronto!** Seu repositório privado está conectado ao Easypanel! 🎉
