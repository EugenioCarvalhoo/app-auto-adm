> **Desatualizado:** este guia histórico cita `node server.js`/Nixpacks, que não existem mais. O deploy atual usa Docker: veja [docs/DEPLOY-DOCKER.md](docs/DEPLOY-DOCKER.md).

# 🔑 Configurar GitHub Token no Easypanel

Guia passo a passo para gerar o token do GitHub e configurar no Easypanel.

---

## 📋 PASSO A PASSO COMPLETO

### PASSO 1: Gerar Personal Access Token no GitHub (5 min)

#### 1.1. Acessar Configurações do GitHub

1. **Faça login no GitHub**
2. **Clique na sua foto de perfil** (canto superior direito)
3. **Clique em "Settings"** (Configurações)

#### 1.2. Navegar para Personal Access Tokens

1. **No menu lateral esquerdo**, role até o final
2. **Clique em "Developer settings"** (Configurações do desenvolvedor)
3. **No menu lateral**, clique em **"Personal access tokens"**
4. **Clique em "Tokens (classic)"** ou **"Fine-grained tokens"**

   **Recomendação**: Use **"Tokens (classic)"** para maior compatibilidade

#### 1.3. Gerar Novo Token

1. **Clique em "Generate new token"**
2. **Selecione "Generate new token (classic)"**

#### 1.4. Configurar o Token

Preencha os campos:

- **Note** (Nota): `Easypanel Deploy` ou `Easypanel - Controle Financeiro`
- **Expiration** (Expiração): 
  - Escolha um período (ex: `90 days`)
  - Ou `No expiration` se quiser que nunca expire (menos seguro, mas mais prático)

#### 1.5. Selecionar Permissões (Scopes)

**IMPORTANTE**: Marque as seguintes permissões:

✅ **repo** (Full control of private repositories)
   - Isso inclui:
     - ✅ `repo:status`
     - ✅ `repo_deployment`
     - ✅ `public_repo`
     - ✅ `repo:invite`
     - ✅ `security_events`

**Opcional** (se usar GitHub Actions):
- ✅ `workflow` (Update GitHub Action workflows)

**NÃO marque outras permissões** a menos que realmente precise!

#### 1.6. Gerar e Copiar Token

1. **Role até o final da página**
2. **Clique em "Generate token"** (botão verde)
3. **⚠️ IMPORTANTE**: O token será mostrado **APENAS UMA VEZ**
4. **COPIE O TOKEN IMEDIATAMENTE** e guarde em local seguro
   - O token começa com `ghp_` (ex: `ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`)

**💡 Dica**: Cole o token em um editor de texto temporário para não perder!

---

### PASSO 2: Configurar Token no Easypanel (3 min)

#### 2.1. Acessar Configurações do Easypanel

1. **No painel do Easypanel**, procure por:
   - **"Settings"** (Configurações)
   - Ou **"⚙️ Settings"** no menu
   - Ou clique no seu perfil → Settings

2. **Procure por**:
   - **"Integrations"** (Integrações)
   - **"GitHub"**
   - **"Source Control"** (Controle de origem)

#### 2.2. Adicionar Token do GitHub

1. **Encontre a seção "GitHub"** ou **"GitHub Token"**
2. **Cole o token** que você copiou:
   - Campo: **"GitHub Token"** ou **"Personal Access Token"**
   - Cole: `ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`
3. **Clique em "Save"** ou **"Save Token"**

#### 2.3. Verificar Conexão

- O Easypanel pode testar a conexão automaticamente
- Ou você verá uma mensagem de sucesso
- Se houver erro, verifique se o token está correto

---

### PASSO 3: Configurar Serviço no Easypanel (5 min)

Agora que o token está configurado, você pode criar o serviço:

#### 3.1. Criar Novo Serviço

1. **Clique em "New Service"** ou **"Add Service"**
2. **Selecione "App"** ou **"Node.js"**
3. **Escolha "GitHub"** como fonte

#### 3.2. Preencher Campos

Agora você verá os campos que mencionou:

**Fonte**: GitHub (já selecionado)

**Proprietário***:
- Digite o **nome de usuário** ou **nome da organização** do GitHub
- Exemplo: `seu-usuario` ou `minha-empresa`
- **Sem o @** e **sem espaços**

**Repositório***:
- Digite **apenas o nome do repositório**
- Exemplo: `controlefinanceiro`
- **Sem espaços**, **sem .git**

**Ramo***:
- Digite o nome da branch principal
- Geralmente: `main` ou `master`
- Verifique no GitHub qual é a branch principal do seu repositório

**Caminho de Build***:
- Se o backend está na raiz: `/` ou deixe vazio
- Se o backend está em `backend/`: `/backend`
- Se está em outra pasta: `/caminho/para/backend`

#### 3.3. Exemplo de Preenchimento

Se seu repositório é: `https://github.com/joaosilva/controlefinanceiro`

```
Proprietário: joaosilva
Repositório: controlefinanceiro
Ramo: main
Caminho de Build: /backend
```

#### 3.4. Continuar Configuração

1. **Clique em "Next"** ou **"Continue"**
2. **Configure as outras opções**:
   - Port: `5000`
   - Build Command: (deixe vazio ou `npm install`)
   - Start Command: `node server.js`
   - Variáveis de ambiente (veja `DEPLOY_EASYPANEL.md`)

---

## 🔍 Como Descobrir as Informações do Repositório

### Proprietário e Repositório:

1. **Acesse seu repositório no GitHub**
2. **Olhe a URL**: `https://github.com/USUARIO/REPOSITORIO`
   - **Proprietário**: `USUARIO`
   - **Repositório**: `REPOSITORIO`

### Branch Principal:

1. **No repositório GitHub**, olhe o canto superior esquerdo
2. **Veja qual branch está selecionada** (geralmente `main` ou `master`)
3. **Ou vá em**: Settings → Branches → Default branch

### Caminho de Build:

1. **No GitHub**, navegue pelo repositório
2. **Veja onde está o `package.json` do backend**
3. **Se está em `backend/package.json`**: use `/backend`
4. **Se está na raiz**: use `/`

---

## ✅ Checklist de Verificação

Antes de fazer deploy:

- [ ] Token gerado no GitHub (começa com `ghp_`)
- [ ] Token configurado nas Settings do Easypanel
- [ ] Token testado e funcionando
- [ ] Proprietário correto (sem @, sem espaços)
- [ ] Repositório correto (sem .git, sem espaços)
- [ ] Branch existe no repositório
- [ ] Caminho de Build aponta para onde está o `package.json`
- [ ] Código está commitado e pushado para a branch selecionada

---

## 🆘 Troubleshooting

### Erro: "Invalid token" ou "Token not found"

**Solução**:
1. Verifique se copiou o token completo (começa com `ghp_`)
2. Confirme que o token não expirou
3. Verifique se salvou o token nas Settings do Easypanel
4. Gere um novo token se necessário

### Erro: "Repository not found"

**Solução**:
1. Verifique se o **Proprietário** está correto (case-sensitive)
2. Verifique se o **Repositório** está correto (case-sensitive)
3. Confirme que o token tem permissão `repo`
4. Teste acessando o repositório no GitHub com a mesma conta

### Erro: "Branch not found"

**Solução**:
1. Verifique se a branch existe no GitHub
2. Confirme o nome exato da branch (case-sensitive)
3. Verifique se você fez push para essa branch

### Erro: "Build failed" ou "Cannot find package.json"

**Solução**:
1. Verifique o **Caminho de Build**
2. Confirme que o `package.json` está no caminho especificado
3. Se o backend está em `backend/`, use `/backend`
4. Se está na raiz, use `/` ou deixe vazio

### Token não aparece nas Settings

**Solução**:
1. Procure por "Integrations", "GitHub", "Source Control"
2. Verifique se você tem permissão de administrador no Easypanel
3. Consulte a documentação do Easypanel para a versão específica

---

## 🔐 Segurança do Token

### Boas Práticas:

1. **Não compartilhe o token** publicamente
2. **Use expiração** quando possível (ex: 90 dias)
3. **Revogue tokens antigos** que não usa mais
4. **Use tokens específicos** para cada serviço
5. **Nunca commite tokens** no código

### Revogar Token (se necessário):

1. **GitHub → Settings → Developer settings → Personal access tokens**
2. **Encontre o token** que você criou
3. **Clique em "Revoke"** (Revogar)

---

## 📝 Resumo Rápido

1. **GitHub → Settings → Developer settings → Personal access tokens → Generate new token (classic)**
2. **Marque permissão `repo`** e gere
3. **Copie o token** (`ghp_...`)
4. **Easypanel → Settings → GitHub → Cole o token**
5. **New Service → Preencha**:
   - Proprietário: `seu-usuario`
   - Repositório: `controlefinanceiro`
   - Ramo: `main`
   - Caminho de Build: `/backend`
6. **Configure e faça deploy!**

---

## 🎯 Exemplo Visual

```
GitHub URL: https://github.com/joaosilva/controlefinanceiro
                    └─────────┘ └──────────────┘
                    Proprietário  Repositório

Estrutura do repositório:
controlefinanceiro/
├── backend/
│   ├── package.json  ← Caminho de Build: /backend
│   └── server.js
└── frontend/
    └── package.json
```

**Pronto!** Agora você pode fazer deploy do repositório privado! 🚀
