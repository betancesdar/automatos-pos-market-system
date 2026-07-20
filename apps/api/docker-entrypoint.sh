#!/bin/sh
set -e

echo "▶ Applying database schema..."
cd /app/packages/database
npx prisma db push --accept-data-loss

echo "▶ Starting API..."
cd /app
exec node apps/api/dist/main.js
