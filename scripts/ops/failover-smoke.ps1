param(
  [Parameter(Mandatory = $true)]
  [string]$PrimaryApiBaseUrl,
  [Parameter(Mandatory = $true)]
  [string]$FailoverApiBaseUrl,
  [int]$TimeoutSeconds = 8
)

$ErrorActionPreference = "Stop"

function Test-Endpoint {
  param(
    [string]$Name,
    [string]$Url,
    [int]$Timeout
  )

  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  try {
    $response = Invoke-WebRequest -Uri $Url -Method GET -TimeoutSec $Timeout -UseBasicParsing
    $sw.Stop()
    return [pscustomobject]@{
      Name = $Name
      Url = $Url
      StatusCode = $response.StatusCode
      Ok = ($response.StatusCode -eq 200)
      LatencyMs = [math]::Round($sw.Elapsed.TotalMilliseconds, 2)
    }
  } catch {
    $sw.Stop()
    return [pscustomobject]@{
      Name = $Name
      Url = $Url
      StatusCode = 0
      Ok = $false
      LatencyMs = [math]::Round($sw.Elapsed.TotalMilliseconds, 2)
    }
  }
}

$checks = @(
  @{ Name = "primary-api-ready"; Url = "$PrimaryApiBaseUrl/health/ready" },
  @{ Name = "primary-api-live"; Url = "$PrimaryApiBaseUrl/health/live" },
  @{ Name = "failover-api-ready"; Url = "$FailoverApiBaseUrl/health/ready" },
  @{ Name = "failover-api-live"; Url = "$FailoverApiBaseUrl/health/live" }
)

$results = @()
foreach ($check in $checks) {
  $results += Test-Endpoint -Name $check.Name -Url $check.Url -Timeout $TimeoutSeconds
}

$results | Format-Table -AutoSize

$failed = $results | Where-Object { -not $_.Ok }
if ($failed.Count -gt 0) {
  Write-Error "Failover smoke failed. One or more readiness/liveness checks are unhealthy."
}

Write-Host "Failover smoke passed."
