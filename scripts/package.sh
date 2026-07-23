#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PARENT="$(dirname "$ROOT")"
ARCHIVE="$PARENT/token-factory.zip"
rm -f "$ARCHIVE"
cd "$PARENT"
zip -rq "$ARCHIVE" token-factory \
  -x "*/node_modules/*" "*/.next/*" "*/dist/*" "*/coverage/*" "*.tsbuildinfo" "*/.DS_Store" \
  -x "*/.git/*" "*/.env" "*/.env.local" "*/.env.production" \
  -x "token-factory/logs/*" "token-factory/uploads/*" "token-factory/exports/*" \
  -x "token-factory/gateway/logs/*" "token-factory/gateway/uploads/*" "token-factory/gateway/exports/*" \
  -x "token-factory/worker/logs/*" "token-factory/worker/uploads/*" "token-factory/worker/exports/*" \
  -x "*/token-factory.zip"
echo "$ARCHIVE"
