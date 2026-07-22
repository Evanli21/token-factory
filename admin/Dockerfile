FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY . .
RUN npm ci
ARG NEXT_PUBLIC_API_BASE_URL=http://localhost:8000
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL
RUN npm run build -w @token-factory/admin

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app /app
EXPOSE 3001
CMD ["npm", "run", "start", "-w", "@token-factory/admin"]
