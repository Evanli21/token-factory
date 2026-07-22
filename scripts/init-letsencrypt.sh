#!/usr/bin/env bash
set -euo pipefail
: "${DOMAIN:?Set DOMAIN in .env.production}"
: "${LETSENCRYPT_EMAIL:?Set LETSENCRYPT_EMAIL in .env.production}"

docker compose -f docker-compose.prod.yml up -d postgres redis gateway worker web admin
docker run --rm -p 80:80 \
  -v token-factory-prod_letsencrypt:/etc/letsencrypt \
  certbot/certbot certonly --standalone --non-interactive --agree-tos \
  --email "$LETSENCRYPT_EMAIL" \
  -d "$DOMAIN" -d "admin.$DOMAIN" -d "api.$DOMAIN"
docker compose -f docker-compose.prod.yml up -d nginx
