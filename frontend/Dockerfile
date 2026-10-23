# Dockerfile do frontend (React 18 / CRA servido pelo nginx)

# Stage 1: build
FROM node:18-alpine AS build
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

# O CRA embute REACT_APP_* no JS na hora do build; variável só no container em runtime não altera o bundle.
# Informe a URL pública da API (com /api), ex.: https://api.exemplo.com/api
# Sem ela, src/config.js deduz o host da API a partir do hostname (ver o arquivo).
ARG REACT_APP_API_URL
ENV REACT_APP_API_URL=$REACT_APP_API_URL

RUN npm run build

# Stage 2: nginx servindo o build estático
FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/build /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
