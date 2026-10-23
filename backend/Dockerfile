# Dockerfile para o backend Node.js (TypeScript compilado em dist/)
FROM node:18-alpine AS build
WORKDIR /app
COPY package*.json ./
# Precisa das devDependencies (typescript, @types/*) para compilar
RUN npm ci
COPY . .
RUN npm run build

FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
# Código compilado + scripts/migrations (JS puro, usados por npm run migrate / create-admin)
COPY --from=build /app/dist ./dist
COPY database ./database

EXPOSE 5000

CMD ["node", "dist/server.js"]
