#!/usr/bin/env bash
# MiniMarket OS — Production deploy (Docker Compose)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [ ! -f .env ]; then
  echo "❌  Missing .env — copy from template first:"
  echo "    cp .env.production .env"
  echo "    # Edit passwords, JWT_SECRET, and YOUR_DROPLET_IP"
  exit 1
fi

# shellcheck disable=SC1091
source .env

for var in POSTGRES_PASSWORD REDIS_PASSWORD JWT_SECRET COOKIE_SECRET NEXT_PUBLIC_API_URL CORS_ORIGINS; do
  if [ -z "${!var:-}" ] || [[ "${!var}" == CHANGE_ME* ]] || [[ "${!var}" == *YOUR_DROPLET_IP* ]]; then
    echo "❌  Set $var in .env before deploying"
    exit 1
  fi
done

echo "▶ Building images..."
docker compose -f docker-compose.prod.yml build --no-cache

echo "▶ Starting stack..."
docker compose -f docker-compose.prod.yml up -d

echo "▶ Waiting for API health..."
sleep 8
if curl -sf "http://localhost:4000" >/dev/null 2>&1 || curl -sf "http://127.0.0.1:4000" >/dev/null 2>&1; then
  echo "✅  API responding on :4000"
else
  echo "⚠️   API not yet reachable — check: docker compose -f docker-compose.prod.yml logs minimarket_api_prod"
fi

echo ""
echo "✅  Deploy complete"
echo "   Web:  http://$(echo "$NEXT_PUBLIC_API_URL" | sed 's|:4000||'):3000"
echo "   API:  $NEXT_PUBLIC_API_URL"
echo ""
echo "   Seed demo data (first time only):"
echo "   DATABASE_URL=\"postgresql://\${POSTGRES_USER}:\${POSTGRES_PASSWORD}@localhost:5432/\${POSTGRES_DB}\" \\"
echo "     pnpm --filter database exec prisma db seed"
