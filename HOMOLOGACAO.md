# Ambiente de homologação (Easypanel / containers)

O código é o **mesmo** entre produção e homologação. A separação é feita por **deploy** (outro serviço no Easypanel) e **variáveis de ambiente**, em especial o **banco de dados**.

## O que fazer no Easypanel

1. **Duplicar o stack** (ou criar um segundo projeto) para homologação, por exemplo:
   - `controlefinanceiro-api-hml` + `controlefinanceiro-web-hml`
2. **Banco PostgreSQL separado** só para homologação (novo serviço DB ou novo database/user).
3. No container **backend (hml)**, definir env:
   - `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` → apontando para o banco de **homologação**
   - `JWT_SECRET` → pode ser diferente da produção
   - `NODE_ENV=production` (ou `development` se preferir logs mais verbosos)
4. No container **frontend (hml)**, no build, definir:
   - `REACT_APP_API_URL` → URL pública da API de homologação (ex.: `https://api-hml.seudominio.com/api`)

## Fluxo de trabalho

- Commits no Git → build da imagem ou deploy manual no serviço desejado (**prod** ou **hml**).
- Não é necessário alterar código para “trocar” de ambiente: basta implantar no container correto, cada um com seu `.env`.

## Migrações

Rodar `npm run migrate` (ou o comando equivalente no container) **no banco de homologação** após subir a primeira vez ou quando houver novas migrações.

## Referência de arquivos

- `backend/.env.example` — variáveis do servidor e banco.
- `frontend/.env.example` — URL da API consumida pelo build do React.
