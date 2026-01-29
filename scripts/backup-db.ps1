$ErrorActionPreference = "Stop"

# Configuration
$ContainerName = "evzone-postgres"
$DbUser = "postgres" # Default user from docker-compose
if ($env:DB_USER) { $DbUser = $env:DB_USER }
$DbName = "evzone"   # Default db from docker-compose
if ($env:DB_NAME) { $DbName = $env:DB_NAME }

# Setup Backup Directory
$ScriptDir = $PSScriptRoot
$BackupDir = Join-Path $ScriptDir "../backups"
if (-not (Test-Path -Path $BackupDir)) {
    New-Item -ItemType Directory -Path $BackupDir | Force | Out-Null
}

$Date = Get-Date -Format "yyyy-MM-dd_HH-mm-ss"
$BackupFile = Join-Path $BackupDir "backup_evzone_$Date.sql"

# Execute Backup
Write-Host "Starting backup for database '$DbName' from container '$ContainerName'..."
try {
    # Note: encoding issues can happen with PowerShell redirection, 
    # but for text SQL dumps it's usually fine. 
    # For robust binary backups, consider docker cp approach.
    docker exec $ContainerName pg_dump -U $DbUser $DbName | Out-File -FilePath $BackupFile -Encoding utf8
    
    Write-Host "✅ Backup created successfully: $BackupFile"
} catch {
    Write-Host "❌ Backup failed: $_"
    exit 1
}
