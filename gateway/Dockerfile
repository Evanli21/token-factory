FROM node:22-bookworm-slim AS base
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates openssl \
 && rm -rf /var/lib/apt/lists/*

FROM base AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY web/package.json web/package.json
COPY admin/package.json admin/package.json
COPY gateway/package.json gateway/package.json
COPY worker/package.json worker/package.json
COPY packages/database/package.json packages/database/package.json
RUN npm ci
COPY . .
RUN npm run prisma:generate \
 && npm run build -w @token-factory/database \
 && npm run build -w @token-factory/gateway

FROM base AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app /app
EXPOSE 8000
CMD ["sh", "-c", "npm run db:push && npm run db:seed && npm run start -w @token-factory/gateway"]
