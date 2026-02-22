param(
  [Parameter(Mandatory = $true)]
  [string]$PrimaryApiBaseUrl,
  [Parameter(Mandatory = $true)]
  [string]$PrimaryWorkerBaseUrl,
  [Parameter(Mandatory = $true)]
  [string]$FailoverApiBaseUrl,
  [Parameter(Mandatory = $true)]
  [string]$FailoverWorkerBaseUrl,
  [int]$TimeoutSeconds = 8,
  [int]$MaxOutboxDepth = 10000,
  [int]$MaxOutboxOldestSec = 600,
  [int]$MaxLatencyDeltaMs = 500
)

$ErrorActionPreference = "Stop"

function Get-Json {
  param(
    [string]$Url,
    [int]$Timeout
  )

  try {
    return Invoke-RestMethod -Uri $Url -Method GET -TimeoutSec $Timeout
  } catch {
    Write-Error "Failed request: $Url"
  }
}

function Test-Region {
  param(
    [string]$RegionName,
    [string]$ApiBaseUrl,
    [string]$WorkerBaseUrl,
    [int]$Timeout
  )

  $apiStopwatch = [System.Diagnostics.Stopwatch]::StartNew()
  $apiReady = Get-Json -Url "$ApiBaseUrl/health/ready" -Timeout $Timeout
  $apiStopwatch.Stop()

  $workerStopwatch = [System.Diagnostics.Stopwatch]::StartNew()
  $workerReady = Get-Json -Url "$WorkerBaseUrl/health/ready" -Timeout $Timeout
  $workerStopwatch.Stop()

  $workerMetrics = Get-Json -Url "$WorkerBaseUrl/health/metrics" -Timeout $Timeout
  $outboxDepth = 0
  $outboxOldestAge = 0
  if ($workerMetrics.gauges.outbox_backlog_depth -ne $null) {
    $outboxDepth = [int]$workerMetrics.gauges.outbox_backlog_depth
  }
  if ($workerMetrics.gauges.outbox_oldest_queued_age_seconds -ne $null) {
    $outboxOldestAge = [int]$workerMetrics.gauges.outbox_oldest_queued_age_seconds
  }

  return [pscustomobject]@{
    Region = $RegionName
    ApiStatus = $apiReady.status
    WorkerStatus = $workerReady.status
    ApiReadyLatencyMs = [math]::Round($apiStopwatch.Elapsed.TotalMilliseconds, 2)
    WorkerReadyLatencyMs = [math]::Round($workerStopwatch.Elapsed.TotalMilliseconds, 2)
    OutboxDepth = $outboxDepth
    OutboxOldestSec = $outboxOldestAge
  }
}

$primary = Test-Region -RegionName "primary" -ApiBaseUrl $PrimaryApiBaseUrl -WorkerBaseUrl $PrimaryWorkerBaseUrl -Timeout $TimeoutSeconds
$failover = Test-Region -RegionName "failover" -ApiBaseUrl $FailoverApiBaseUrl -WorkerBaseUrl $FailoverWorkerBaseUrl -Timeout $TimeoutSeconds

$results = @($primary, $failover)
$results | Format-Table -AutoSize

$failures = @()

foreach ($result in $results) {
  if ($result.ApiStatus -ne "ok") {
    $failures += "$($result.Region) API readiness is not ok"
  }
  if ($result.WorkerStatus -ne "ok") {
    $failures += "$($result.Region) worker readiness is not ok"
  }
  if ($result.OutboxDepth -gt $MaxOutboxDepth) {
    $failures += "$($result.Region) outbox depth above threshold: $($result.OutboxDepth)"
  }
  if ($result.OutboxOldestSec -gt $MaxOutboxOldestSec) {
    $failures += "$($result.Region) outbox oldest age above threshold: $($result.OutboxOldestSec)"
  }
}

$apiLatencyDelta = [math]::Abs($primary.ApiReadyLatencyMs - $failover.ApiReadyLatencyMs)
if ($apiLatencyDelta -gt $MaxLatencyDeltaMs) {
  $failures += "API readiness latency delta too high between regions: $apiLatencyDelta ms"
}

if ($failures.Count -gt 0) {
  $failures | ForEach-Object { Write-Host "FAIL: $_" }
  Write-Error "Failover gate check failed."
}

Write-Host "Failover gate check passed."
