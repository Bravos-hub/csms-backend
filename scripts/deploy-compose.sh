#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

cd "${REPO_ROOT}"

echo "Building images (api, worker, db-migrate)..."
docker compose build api worker db-migrate

echo "Applying Prisma migrations..."
docker compose run --rm db-migrate

echo "Starting services (api, worker)..."
docker compose up -d api worker

echo "Deployment completed successfully."
