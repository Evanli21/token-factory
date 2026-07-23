FROM node:22-bookworm-slim AS base
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates openssl \
 && rm -rf /var/lib/apt/lists/*

FROM base AS build
WORKDIR /app
COPY . .
RUN npm ci
RUN npm run prisma:generate \
 && npm run build -w @token-factory/database \
 && npm run build -w @token-factory/worker

FROM base AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app /app
CMD ["npm", "run", "start", "-w", "@token-factory/worker"]
