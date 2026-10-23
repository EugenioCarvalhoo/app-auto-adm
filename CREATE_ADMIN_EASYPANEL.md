# 🔐 Como Criar Usuário Admin no Easypanel

## 📋 Opções Disponíveis

### Opção 1: Script Node.js (Recomendado) ⭐

O script gera automaticamente o SQL com o hash bcrypt correto.

#### Passo a passo:

1. **Acesse o Terminal do Backend no Easypanel**
   - Vá para o serviço do backend
   - Clique em **"Terminal"** ou **"Console"**

2. **Execute o script gerador**:
   ```bash
   cd backend
   node database/generate_admin_hash.js
   ```

3. **Para usar uma senha customizada**:
   ```bash
   node database/generate_admin_hash.js "minhasenha123"
   ```

4. **O script irá mostrar**:
   - O SQL completo pronto para copiar
   - O arquivo será salvo em `backend/database/create_admin_producao_generated.sql`

5. **Execute o SQL no banco**:
   - Copie o SQL gerado
   - Acesse o terminal do PostgreSQL no Easypanel
   - Conecte ao banco: `psql -U postgres -d controle_financeiro`
   - Cole e execute o SQL

---

### Opção 2: SQL Direto

Se preferir criar o SQL manualmente:

1. **Gere o hash** usando o script:
   ```bash
   node backend/database/generate_admin_hash.js
   ```

2. **Copie o hash gerado** (começa com `$2a$10$`)

3. **Use o SQL em `create_admin_producao.sql`** substituindo `SEU_HASH_AQUI`

4. **Execute no banco de produção**

---

## 🔍 Onde executar no Easypanel

### Terminal do Backend:
```
Serviço Backend → Terminal → Executar script Node.js
```

### Terminal do PostgreSQL:
```
Serviço PostgreSQL → Terminal → Conectar ao banco e executar SQL
```

Ou use o **Console SQL do Easypanel** (se disponível):
```
Serviço PostgreSQL → Console → Cole o SQL e execute
```

---

## ✅ Verificar se funcionou

Após executar o SQL, teste o login no frontend:
- **Username**: `admin`
- **Password**: `admin123` (ou a senha que você escolheu)

---

## 🛡️ Segurança

1. **Mude a senha padrão** após o primeiro login
2. **Use senha forte** em produção
3. **Nunca commite** senhas ou hashes no Git

---

## 📝 Exemplo de SQL Gerado

O script gerará algo assim:

```sql
INSERT INTO usuarios (username, password, nome, is_admin, created_at, updated_at)
VALUES (
  'admin',
  '$2a$10$abcdefghijklmnopqrstuvwxyz1234567890ABCDEFGHIJKLMNOPQRST', 
  'Administrador',
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT (username) 
DO UPDATE SET 
  password = EXCLUDED.password,
  nome = EXCLUDED.nome,
  is_admin = EXCLUDED.is_admin,
  updated_at = CURRENT_TIMESTAMP;
```

---

## 🆘 Troubleshooting

**Erro: "Cannot find module 'bcryptjs'"**
→ Instale as dependências: `npm install` no diretório backend

**Erro: "relation usuarios does not exist"**
→ Execute as migrações primeiro: `npm run migrate`

**Erro ao conectar no PostgreSQL**
→ Verifique se o PostgreSQL está acessível e as credenciais estão corretas
