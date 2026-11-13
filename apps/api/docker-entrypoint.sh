#!/bin/sh
set -e

echo "▶ Applying database migrations..."
cd /app/packages/database
# Versioned, reversible migrations (baseline 0_init). Never db push in prod.
npx prisma migrate deploy

echo "▶ Starting API..."
cd /app
exec node apps/api/dist/main.js
