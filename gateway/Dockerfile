FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY . .
RUN npm ci
RUN npm run prisma:generate \
 && npm run build -w @token-factory/database \
 && npm run build -w @token-factory/gateway

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app /app
EXPOSE 8000
CMD ["sh", "-c", "npm run db:push && npm run db:seed && npm run start -w @token-factory/gateway"]
