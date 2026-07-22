# Production Deployment

## Server baseline

- Ubuntu 24.04 LTS or equivalent, 4 vCPU / 8 GB RAM minimum
- Docker Engine 24+ and Compose v2
- 80/443 open; PostgreSQL and Redis must not be exposed publicly
- Three DNS records for root, `admin`, and `api`

## Secrets

Generate independent values rather than reusing passwords:

```bash
openssl rand -base64 32  # POSTGRES_PASSWORD
openssl rand -base64 32  # REDIS_PASSWORD
openssl rand -base64 48  # JWT_SECRET
openssl rand -base64 48  # API_KEY_PEPPER
openssl rand -base64 48  # INTERNAL_API_TOKEN
```

Keep `.env.production` mode `0600`, outside source control. Set real provider, email, S3 and public URL values as needed.

## First deployment

```bash
cp .env.example .env.production
chmod 600 .env.production
# edit values and DNS, then:
set -a; source .env.production; set +a
bash scripts/init-letsencrypt.sh
```

The Gateway performs idempotent `prisma db push`, applies the pgvector SQL, and seeds default catalog data before accepting traffic. The Worker waits for the Gateway health check.

## Upgrade

```bash
git pull --ff-only
docker compose --env-file .env.production -f docker-compose.prod.yml build
docker compose --env-file .env.production -f docker-compose.prod.yml up -d
docker compose --env-file .env.production -f docker-compose.prod.yml ps
```

For schema changes requiring data migration, create reviewed Prisma migrations in CI rather than relying on `db push`, then change the production Gateway command to `npm run db:migrate && npm run db:sql`.

## Backups

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml exec -T postgres \
  pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc > "token-factory-$(date +%F).dump"
```

Back up the `uploads` and `exports` volumes or use versioned S3 storage. Test database and file restoration regularly.

## Operations

- `/health` is a liveness endpoint; add a private readiness probe that checks PostgreSQL/Redis if your orchestrator requires one.
- Send container logs to a centralized sink and alert on `SystemAlert`, high HTTP 5xx, reservation backlog and BullMQ failed jobs.
- Run Certbot renewal twice daily. Certbot only renews when the certificate is near expiry.
- Scale Gateway horizontally; its request state is in PostgreSQL/Redis. Scale Worker replicas by queue load. Run only one scheduler registration path (the BullMQ job schedulers are idempotent).
