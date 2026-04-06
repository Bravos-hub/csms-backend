param(
  [string]$ApiBaseUrl = 'http://localhost:3000',
  [string]$WorkerBaseUrl = 'http://localhost:3010',
  [string]$PrometheusBaseUrl = 'http://localhost:9090',
  [int]$TimeoutSeconds = 8,
  [switch]$SkipPrometheusTargetCheck
)

$ErrorActionPreference = 'Stop'

$failures = @()
$warnings = @()

function Normalize-BaseUrl {
  param([string]$Url)

  $trimmed = ''
  if ($null -ne $Url) {
    $trimmed = $Url.Trim()
  }
  if (-not $trimmed) {
    throw 'Base URL cannot be empty.'
  }

  return $trimmed.TrimEnd('/')
}

function Add-Failure {
  param([string]$Message)

  $script:failures += $Message
  Write-Host "FAIL: $Message" -ForegroundColor Red
}

function Add-Pass {
  param([string]$Message)

  Write-Host "PASS: $Message" -ForegroundColor Green
}

function Add-Warning {
  param([string]$Message)

  $script:warnings += $Message
  Write-Host "WARN: $Message" -ForegroundColor Yellow
}

function Get-Json {
  param(
    [string]$Url,
    [int]$Timeout
  )

  try {
    return Invoke-RestMethod -Uri $Url -Method GET -TimeoutSec $Timeout
  } catch {
    $message = $_.Exception.Message
    throw "Failed request: $Url ($message)"
  }
}

function Get-Text {
  param(
    [string]$Url,
    [int]$Timeout
  )

  try {
    $response = Invoke-WebRequest -Uri $Url -Method GET -TimeoutSec $Timeout -UseBasicParsing
    if ($null -eq $response -or $null -eq $response.Content) {
      throw "Empty response from $Url"
    }
    return [string]$response.Content
  } catch {
    $message = $_.Exception.Message
    throw "Failed request: $Url ($message)"
  }
}

function Extract-MetricNames {
  param([string]$MetricsText)

  $set = New-Object 'System.Collections.Generic.HashSet[string]'
  $lines = $MetricsText -split "`r?`n"

  foreach ($line in $lines) {
    $trimmed = $line.Trim()
    if (-not $trimmed -or $trimmed.StartsWith('#')) {
      continue
    }

    $match = [regex]::Match($trimmed, '^([a-zA-Z_:][a-zA-Z0-9_:]*)')
    if ($match.Success) {
      [void]$set.Add($match.Groups[1].Value)
    }
  }

  return $set
}

function Assert-RequiredMetrics {
  param(
    [System.Collections.Generic.HashSet[string]]$Observed,
    [string[]]$Required,
    [string]$SourceName
  )

  foreach ($metric in $Required) {
    if ($Observed.Contains($metric)) {
      Add-Pass "$SourceName has metric '$metric'"
    } else {
      Add-Failure "$SourceName is missing required metric '$metric'"
    }
  }
}

function Assert-OptionalMetrics {
  param(
    [System.Collections.Generic.HashSet[string]]$Observed,
    [string[]]$Optional,
    [string]$SourceName
  )

  foreach ($metric in $Optional) {
    if ($Observed.Contains($metric)) {
      Add-Pass "$SourceName has optional metric '$metric'"
    } else {
      Add-Warning "$SourceName missing optional metric '$metric' (may be disabled by config or no traffic yet)"
    }
  }
}

$ApiBaseUrl = Normalize-BaseUrl -Url $ApiBaseUrl
$WorkerBaseUrl = Normalize-BaseUrl -Url $WorkerBaseUrl
$PrometheusBaseUrl = Normalize-BaseUrl -Url $PrometheusBaseUrl

Write-Host 'Running observability smoke check...' -ForegroundColor Cyan
Write-Host "API:        $ApiBaseUrl"
Write-Host "Worker:     $WorkerBaseUrl"
Write-Host "Prometheus: $PrometheusBaseUrl"
Write-Host "Timeout:    $TimeoutSeconds s"

try {
  $apiReady = Get-Json -Url "$ApiBaseUrl/health/ready" -Timeout $TimeoutSeconds
  if ($apiReady.status -eq 'ok') {
    Add-Pass "API readiness is ok"
  } else {
    Add-Failure "API readiness status is '$($apiReady.status)'"
  }
} catch {
  Add-Failure $_.Exception.Message
}

try {
  $workerReady = Get-Json -Url "$WorkerBaseUrl/health/ready" -Timeout $TimeoutSeconds
  if ($workerReady.status -eq 'ok') {
    Add-Pass "Worker readiness is ok"
  } else {
    Add-Failure "Worker readiness status is '$($workerReady.status)'"
  }
} catch {
  Add-Failure $_.Exception.Message
}

try {
  $apiMetricsText = Get-Text -Url "$ApiBaseUrl/health/metrics/prometheus" -Timeout $TimeoutSeconds
  $apiMetrics = Extract-MetricNames -MetricsText $apiMetricsText

  $requiredApiMetrics = @(
    'api_health_ready_status',
    'api_http_requests_total',
    'api_http_errors_total',
    'api_http_route_latency_ms_p95',
    'api_http_route_latency_ms_p99'
  )

  Assert-RequiredMetrics -Observed $apiMetrics -Required $requiredApiMetrics -SourceName 'API metrics endpoint'
} catch {
  Add-Failure $_.Exception.Message
}

try {
  $workerMetricsText = Get-Text -Url "$WorkerBaseUrl/metrics/prometheus" -Timeout $TimeoutSeconds
  $workerMetrics = Extract-MetricNames -MetricsText $workerMetricsText

  $requiredWorkerMetrics = @(
    'worker_health_ready_status',
    'outbox_backlog_depth',
    'outbox_oldest_queued_age_seconds'
  )

  $optionalWorkerMetrics = @(
    'command_events_consumer_lag_total',
    'outbox_publish_success_total',
    'outbox_publish_fail_total',
    'outbox_dead_letter_total'
  )

  Assert-RequiredMetrics -Observed $workerMetrics -Required $requiredWorkerMetrics -SourceName 'Worker metrics endpoint'
  Assert-OptionalMetrics -Observed $workerMetrics -Optional $optionalWorkerMetrics -SourceName 'Worker metrics endpoint'
} catch {
  Add-Failure $_.Exception.Message
}

if (-not $SkipPrometheusTargetCheck) {
  try {
    $targetsResponse = Get-Json -Url "$PrometheusBaseUrl/api/v1/targets" -Timeout $TimeoutSeconds

    if ($targetsResponse.status -ne 'success') {
      Add-Failure "Prometheus target API returned status '$($targetsResponse.status)'"
    } else {
      $activeTargets = @($targetsResponse.data.activeTargets)

      if ($activeTargets.Count -eq 0) {
        Add-Failure 'Prometheus has no active scrape targets.'
      } else {
        $apiTarget = $activeTargets | Where-Object {
          ($_.scrapeUrl -as [string]) -match '/health/metrics/prometheus(\?.*)?$'
        } | Select-Object -First 1

        $workerTarget = $activeTargets | Where-Object {
          ($_.scrapeUrl -as [string]) -match '/metrics/prometheus(\?.*)?$' -and
          -not (($_.scrapeUrl -as [string]) -match '/health/metrics/prometheus(\?.*)?$')
        } | Select-Object -First 1

        if (-not $apiTarget) {
          Add-Failure 'Prometheus target for API metrics path (/health/metrics/prometheus) not found.'
        } elseif ($apiTarget.health -ne 'up') {
          Add-Failure "Prometheus API target is '$($apiTarget.health)' (lastError: $($apiTarget.lastError))"
        } else {
          Add-Pass "Prometheus API target is up (job: $($apiTarget.labels.job))"
        }

        if (-not $workerTarget) {
          Add-Failure 'Prometheus target for worker metrics path (/metrics/prometheus) not found.'
        } elseif ($workerTarget.health -ne 'up') {
          Add-Failure "Prometheus worker target is '$($workerTarget.health)' (lastError: $($workerTarget.lastError))"
        } else {
          Add-Pass "Prometheus worker target is up (job: $($workerTarget.labels.job))"
        }
      }
    }
  } catch {
    Add-Failure $_.Exception.Message
  }
} else {
  Add-Warning 'Skipped Prometheus target health check by request.'
}

Write-Host ''
Write-Host "Smoke check summary: $($failures.Count) failure(s), $($warnings.Count) warning(s)."

if ($warnings.Count -gt 0) {
  $warnings | ForEach-Object { Write-Host "WARN: $_" -ForegroundColor Yellow }
}

if ($failures.Count -gt 0) {
  Write-Error 'Observability smoke check failed.'
}

Write-Host 'Observability smoke check passed.' -ForegroundColor Green
