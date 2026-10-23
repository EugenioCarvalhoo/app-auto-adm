# Dockerfile do backend (Node + TypeScript compilado em dist/)

# Stage 1: build — precisa das devDependencies (typescript, @types/*) para o tsc
FROM node:18-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Stage 2: runtime — só dependências de produção + dist/ + database/ (migrate/create_admin em JS puro)
FROM node:18-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY database ./database
# scripts/limpar-boletos.js (npm run limpar-boletos) usa o storage compilado em dist/.
# As imagens dos boletos ficam em um servico S3-compativel (MinIO) via STORAGE_*; a imagem nao tem volume.
COPY scripts ./scripts

# Roda sem root
USER node

EXPOSE 5000

# Liveness (não consulta o banco). Readiness com Postgres: GET /api/health/ready
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD wget -q -O /dev/null "http://127.0.0.1:${PORT:-5000}/api/health" || exit 1

# Aplica as migrations pendentes (idempotente, via schema_migrations) e inicia a API.
# RUN_MIGRATIONS=0 pula as migrations. `exec` deixa o Node como PID 1 para receber o SIGTERM.
CMD ["sh", "-c", "if [ \"$RUN_MIGRATIONS\" != \"0\" ]; then node database/migrate.js || exit 1; fi; exec node dist/server.js"]
