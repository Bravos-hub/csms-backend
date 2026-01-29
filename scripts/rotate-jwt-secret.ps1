$ErrorActionPreference = "Stop"

function Generate-RandomSecret {
    param (
        [int]$Length = 64
    )
    $Bytes = New-Object byte[] $Length
    $Rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    $Rng.GetBytes($Bytes)
    return [Convert]::ToBase64String($Bytes)
}

Write-Host "🔐 EVZone Secret Rotation Helper"
Write-Host "--------------------------------"

# Generate new secrets
$NewJwtSecret = Generate-RandomSecret
$NewRefreshSecret = Generate-RandomSecret

Write-Host "`n[NEW] JWT_SECRET:" -ForegroundColor Green
Write-Host $NewJwtSecret

Write-Host "`n[NEW] JWT_REFRESH_SECRET:" -ForegroundColor Green
Write-Host $NewRefreshSecret

Write-Host "`n⚠️  ACTION REQUIRED:" -ForegroundColor Yellow
Write-Host "1. Update your .env file (or Secrets Manager) with these new values."
Write-Host "2. Restart the 'api' service for changes to take effect."
Write-Host "3. Note: This will invalidate all existing tokens."
