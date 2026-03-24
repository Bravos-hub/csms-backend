$ErrorActionPreference = "Stop"

param(
    [ValidateSet("local", "remote")]
    [string]$Mode = "local",
    [switch]$SkipDocker,
    [switch]$NoSyncDotEnv
)

$profileFile = if ($Mode -eq "local") { ".env.local" } else { ".env.remote" }

if (-not (Test-Path $profileFile)) {
    Write-Error "Missing profile file: $profileFile. Create it from .env.example first."
    exit 1
}

if (-not $NoSyncDotEnv) {
    Copy-Item -Path $profileFile -Destination ".env" -Force
    Write-Host "Synced $profileFile -> .env" -ForegroundColor Green
}

$env:ENV_FILE = $profileFile
if ($Mode -eq "local") {
    $env:NODE_ENV = "development"
}

Write-Host "Starting EVZone backend in '$Mode' mode" -ForegroundColor Cyan
Write-Host "ENV_FILE=$($env:ENV_FILE)" -ForegroundColor Gray
Write-Host "NODE_ENV=$($env:NODE_ENV)" -ForegroundColor Gray

if ($Mode -eq "local" -and -not $SkipDocker) {
    Write-Host "Optional local docker compose startup..." -ForegroundColor Yellow
    try {
        docker-compose up -d
    } catch {
        Write-Warning "docker-compose startup skipped/failed. Proceeding with app start."
    }
}

npm run start:dev

