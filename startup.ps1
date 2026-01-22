$ErrorActionPreference = "Stop"

Write-Host "🚀 Starting EVZone Backend Environment..." -ForegroundColor Cyan

# 1. Start Infrastructure (Docker)
Write-Host "Step 1: Starting Infrastructure (Postgres, Redis, Kafka)..." -ForegroundColor Yellow
try {
    docker-compose up -d
    Write-Host "✅ Infrastructure started!" -ForegroundColor Green
} catch {
    Write-Error "❌ Failed to start docker-compose. Is Docker running?"
    exit 1
}

# Wait for Kafka to be ready
Write-Host "⏳ Waiting 10s for Kafka to stabilize..." -ForegroundColor Gray
Start-Sleep -Seconds 10

# 2. Start Microservices in separate windows
Write-Host "Step 2: Starting Microservices..." -ForegroundColor Yellow

$services = @(
    "auth-service", 
    "station-service", 
    "session-service", 
    "ocpp-gateway",
    "billing-service",
    "booking-service",
    "maintenance-service",
    "notification-service",
    "analytics-service"
)

foreach ($service in $services) {
    Write-Host "   Starting $service..." -ForegroundColor Gray
    Start-Process powershell -ArgumentList "-NoExit", "-Command", "& {Write-Host 'Starting $service...'; npx nest start $service --watch}"
}

Write-Host "✅ All services launched!" -ForegroundColor Green
Write-Host "---------------------------------------------------"
Write-Host "Auth Service:          http://localhost:3000"
Write-Host "Station Service:       http://localhost:3001"
Write-Host "Session Service:       http://localhost:3002"
Write-Host "OCPP Gateway:          ws://localhost:3003/ocpp/{id}"
Write-Host "Billing Service:       http://localhost:3004"
Write-Host "Booking Service:       http://localhost:3005"
Write-Host "Maintenance Service:   http://localhost:3006"
Write-Host "Notification Service:  http://localhost:3007"
Write-Host "Analytics Service:     http://localhost:3008"
Write-Host "---------------------------------------------------"
Write-Host "Press any key to exit this launcher (services will keep running)..."
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
