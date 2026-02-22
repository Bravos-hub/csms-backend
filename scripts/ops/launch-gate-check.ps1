param(
  [Parameter(Mandatory = $true)]
  [string]$ApiBaseUrl,
  [Parameter(Mandatory = $true)]
  [string]$WorkerBaseUrl,
  [int]$TimeoutSeconds = 8
)

$ErrorActionPreference = "Stop"

function Get-Json {
  param(
    [string]$Url,
    [int]$Timeout
  )

  try {
    $response = Invoke-RestMethod -Uri $Url -Method GET -TimeoutSec $Timeout
    return $response
  } catch {
    Write-Error "Failed request: $Url"
  }
}

$apiReady = Get-Json -Url "$ApiBaseUrl/health/ready" -Timeout $TimeoutSeconds
$workerReady = Get-Json -Url "$WorkerBaseUrl/health/ready" -Timeout $TimeoutSeconds
$workerMetrics = Get-Json -Url "$WorkerBaseUrl/health/metrics" -Timeout $TimeoutSeconds

$outboxDepth = 0
$outboxOldestAge = 0
if ($workerMetrics.gauges.outbox_backlog_depth -ne $null) {
  $outboxDepth = [int]$workerMetrics.gauges.outbox_backlog_depth
}
if ($workerMetrics.gauges.outbox_oldest_queued_age_seconds -ne $null) {
  $outboxOldestAge = [int]$workerMetrics.gauges.outbox_oldest_queued_age_seconds
}

$gateFailures = @()

if ($apiReady.status -ne "ok") {
  $gateFailures += "API readiness is not ok"
}
if ($workerReady.status -ne "ok") {
  $gateFailures += "Worker readiness is not ok"
}
if ($outboxDepth -gt 10000) {
  $gateFailures += "Outbox backlog depth exceeds threshold: $outboxDepth"
}
if ($outboxOldestAge -gt 600) {
  $gateFailures += "Outbox oldest queued age exceeds threshold: $outboxOldestAge"
}

Write-Host "API status: $($apiReady.status)"
Write-Host "Worker status: $($workerReady.status)"
Write-Host "Outbox backlog depth: $outboxDepth"
Write-Host "Outbox oldest age sec: $outboxOldestAge"

if ($gateFailures.Count -gt 0) {
  $gateFailures | ForEach-Object { Write-Host "FAIL: $_" }
  Write-Error "Launch gate check failed."
}

Write-Host "Launch gate check passed."
