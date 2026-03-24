$ErrorActionPreference = "Stop"

param([switch]$SkipDocker)

if (-not (Test-Path ".env")) {
    Write-Error "Missing .env. Create it from .env.example and set the required values first."
    exit 1
}

Write-Host "Starting EVZone backend using .env" -ForegroundColor Cyan

if (-not $SkipDocker) {
    Write-Host "Optional local docker compose startup..." -ForegroundColor Yellow
    try {
        docker-compose up -d
    } catch {
        Write-Warning "docker-compose startup skipped/failed. Proceeding with app start."
    }
}

npm run start:dev
