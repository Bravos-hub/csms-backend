#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

cd "${REPO_ROOT}"

export DOCKER_CLIENT_TIMEOUT="${DOCKER_CLIENT_TIMEOUT:-1800}"
export COMPOSE_HTTP_TIMEOUT="${COMPOSE_HTTP_TIMEOUT:-1800}"

build_backend_image() {
  local max_attempts=3
  local attempt=1
  while [ "$attempt" -le "$max_attempts" ]; do
    echo "Building backend image (attempt ${attempt}/${max_attempts})..."
    if docker compose build --progress=plain api; then
      return 0
    fi

    if [ "$attempt" -ge "$max_attempts" ]; then
      echo "Backend image build failed after ${max_attempts} attempts."
      return 1
    fi

    echo "Backend image build attempt ${attempt} failed. Retrying in 10 seconds..."
    attempt=$((attempt + 1))
    sleep 10
  done
}

build_backend_image

echo "Applying Prisma migrations..."
docker compose run --rm db-migrate

echo "Starting services (api, worker)..."
docker compose up -d api worker

echo "Deployment completed successfully."

