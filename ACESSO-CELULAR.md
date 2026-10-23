# Como Acessar pelo Celular

## Passo a Passo

### 1. Descobrir o IP da sua máquina
Execute no terminal:
```bash
npm run get-ip
```

Você verá algo como:
```
IP: 10.206.91.50
Frontend: http://10.206.91.50:3000
Backend:  http://10.206.91.50:5000
```

### 2. Configurar Firewall (Windows)
1. Abra o "Firewall do Windows Defender"
2. Clique em "Configurações Avançadas"
3. Clique em "Regras de Entrada" → "Nova Regra"
4. Selecione "Porta" → Próximo
5. Selecione "TCP" e digite as portas: `3000, 5000`
6. Selecione "Permitir a conexão"
7. Aplique para todos os perfis
8. Dê um nome (ex: "Controle Financeiro")

**OU** desative temporariamente o firewall para testar.

### 3. Iniciar o Sistema
```bash
npm run dev
```

### 4. Acessar pelo Celular
1. Certifique-se de que o celular está na **mesma rede Wi-Fi** do computador
2. Abra o navegador do celular
3. Digite o IP mostrado no passo 1, porta 3000:
   ```
   http://10.206.91.50:3000
   ```
   (Substitua pelo IP da sua máquina)

### 5. Credenciais de Login
- **Usuário:** admin
- **Senha:** admin123

## Troubleshooting

### Não consegue acessar?
1. Verifique se o celular está na mesma rede Wi-Fi
2. Verifique se o firewall está permitindo as portas 3000 e 5000
3. Verifique se o servidor está rodando (veja o terminal)
4. Tente desativar temporariamente o antivírus/firewall
5. Verifique se o IP mudou (execute `npm run get-ip` novamente)

### IP mudou?
Se o IP da sua máquina mudar (normal em redes dinâmicas), execute novamente:
```bash
npm run get-ip
```

## Notas
- O sistema detecta automaticamente se está sendo acessado de outro dispositivo
- A URL da API é ajustada automaticamente
- Funciona tanto em localhost quanto em rede local

