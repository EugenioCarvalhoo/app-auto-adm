# 📋 Comandos para Ver Logs no Easypanel

Guia de comandos úteis para visualizar e analisar logs no terminal do backend.

---

## 🖥️ ACESSAR TERMINAL DO BACKEND

### No Easypanel:

1. **No serviço backend**, clique em **"Terminal"** ou **"Console"**
2. Isso abre um terminal interativo dentro do container

---

## 📜 COMANDOS PARA VER LOGS

### 1. Ver Logs em Tempo Real (Recomendado)

```bash
# Ver últimos logs e acompanhar em tempo real
tail -f /proc/1/fd/1
```

Ou simplesmente ver saída padrão:
```bash
# Ver saída do processo principal
ps aux
# Depois ver stdout do processo
```

**Melhor opção** - Ver logs direto do stdout/stderr:
```bash
# Ver últimas 100 linhas e acompanhar
tail -n 100 -f /dev/stdout 2>&1
```

---

### 2. Ver Últimas Linhas de Log

```bash
# Últimas 50 linhas
tail -n 50 /proc/1/fd/1

# Últimas 100 linhas
tail -n 100 /proc/1/fd/1

# Últimas 200 linhas
tail -n 200 /proc/1/fd/1
```

---

### 3. Ver Tudo com Scroll

```bash
# Ver tudo e permitir scroll
cat /proc/1/fd/1 | less

# Ou simplesmente
less /proc/1/fd/1
```

**Navegação no `less`**:
- `Espaço` = página para baixo
- `b` = página para cima
- `q` = sair
- `/texto` = buscar texto

---

### 4. Buscar por Texto nos Logs

```bash
# Buscar por "erro" (case insensitive)
grep -i erro /proc/1/fd/1 | tail -n 50

# Buscar por "SIGTERM"
grep -i sigterm /proc/1/fd/1 | tail -n 50

# Buscar por "conectado"
grep -i conectado /proc/1/fd/1 | tail -n 50

# Buscar por múltiplos termos
grep -E "erro|error|fail" /proc/1/fd/1 | tail -n 50
```

---

### 5. Ver Logs de Erro (stderr)

```bash
# Ver stderr (erros)
tail -f /proc/1/fd/2

# Ver stdout e stderr juntos
tail -f /proc/1/fd/1 /proc/1/fd/2
```

---

### 6. Verificar se o Servidor Está Rodando

```bash
# Ver processos Node.js
ps aux | grep node

# Ver processos na porta 5000
netstat -tulpn | grep 5000

# Ou usar ss (alternativa moderna)
ss -tulpn | grep 5000

# Ver porta que está escutando
lsof -i :5000
```

---

### 7. Ver Variáveis de Ambiente

```bash
# Ver todas as variáveis
env

# Ver variável específica
echo $PORT
echo $DB_HOST
echo $DB_PORT

# Ver variáveis relacionadas a DB
env | grep DB_
```

---

### 8. Testar Conexão com o Backend (Local)

```bash
# Testar se porta 5000 está respondendo
curl http://localhost:5000/health

# Ou usar wget
wget -O- http://localhost:5000/health
```

---

## 🔍 COMANDOS ÚTEIS PARA DIAGNÓSTICO

### Verificar Status do Serviço

```bash
# Ver se Node.js está rodando
ps aux | grep -E "node|npm"

# Ver uso de recursos
top
# ou
htop  # se disponível

# Ver espaço em disco
df -h
```

---

### Verificar Código/Dependências

```bash
# Ver se package.json existe
cat package.json

# Ver se node_modules existe
ls -la node_modules/ | head -20

# Ver estrutura do projeto
ls -la

# Ver conteúdo de server.js (últimas linhas)
tail -n 50 server.js
```

---

### Verificar Conexão com Banco

```bash
# Testar conexão PostgreSQL (se psql estiver disponível)
psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -c "SELECT 1;"

# Ou usar node para testar
node -e "const { Pool } = require('pg'); const pool = new Pool({ host: process.env.DB_HOST, port: process.env.DB_PORT, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME }); pool.query('SELECT 1').then(() => console.log('OK')).catch(e => console.error(e)).finally(() => process.exit());"
```

---

## 📊 COMANDOS AVANÇADOS

### Contar Linhas de Log

```bash
# Total de linhas
wc -l /proc/1/fd/1

# Contar erros
grep -i erro /proc/1/fd/1 | wc -l
```

---

### Filtrar Logs por Data/Hora

```bash
# Ver logs das últimas horas (exemplo)
grep "2026-01-18" /proc/1/fd/1 | tail -n 50
```

---

### Salvar Logs em Arquivo

```bash
# Salvar logs em arquivo (últimas 200 linhas)
tail -n 200 /proc/1/fd/1 > /tmp/logs.txt
cat /tmp/logs.txt

# Ou copiar para fora (se possível)
```

---

## ⚠️ NOTA IMPORTANTE

**No Easypanel, os logs geralmente aparecem automaticamente na interface web!**

1. **Vá em "Logs"** no serviço backend
2. Os logs aparecem em tempo real
3. Pode filtrar, buscar, etc.

**Use o terminal apenas se**:
- Precisa de comandos específicos
- Quer testar conexões
- Precisa verificar variáveis/arquivos

---

## 🎯 COMANDO MAIS ÚTIL PARA LOGS

**Para ver logs em tempo real** (mais útil):

```bash
tail -f /proc/1/fd/1 2>&1
```

Ou simplesmente use a **interface web de Logs** do Easypanel! 🎉

---

## 📝 RESUMO RÁPIDO

```bash
# Ver últimas 100 linhas de log
tail -n 100 /proc/1/fd/1

# Acompanhar logs em tempo real
tail -f /proc/1/fd/1

# Buscar erros
grep -i erro /proc/1/fd/1 | tail -n 50

# Testar saúde do backend
curl http://localhost:5000/health

# Ver variáveis
echo $PORT
env | grep DB_
```

---

**Dica**: A interface web de Logs do Easypanel é geralmente mais fácil de usar! 😊
