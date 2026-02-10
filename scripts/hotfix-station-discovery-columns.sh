#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

cd "${REPO_ROOT}"

echo "Applying stations schema hotfix inside running api container..."
docker compose exec api sh -lc "npx prisma db execute --url \"$DATABASE_URL\" --file prisma/hotfixes/20260210_station_discovery_columns_hotfix.sql"

echo "Restarting api container..."
docker compose restart api

echo "Hotfix applied. Check logs:"
echo "docker logs csms-backend-api-1 --tail 100"
