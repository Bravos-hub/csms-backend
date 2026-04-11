param(
  [Parameter(Mandatory = $true)]
  [string]$ApiBaseUrl,
  [Parameter(Mandatory = $true)]
  [string]$WorkerBaseUrl,
  [string]$PrometheusBaseUrl = 'http://localhost:9090',
  [string]$EnvironmentLabel = 'staging',
  [string]$OutputRoot = '..\..\..\docs\signoff-evidence\2026-q2\03-reliability\runs',
  [string]$BackendCommitRef = '',
  [string]$RollbackTrigger = '',
  [string]$RollbackStartedAtUtc = '',
  [string]$RollbackCompletedAtUtc = '',
  [string]$RollbackOwner = '',
  [string[]]$DashboardEvidenceLinks = @(),
  [string]$FailoverApiBaseUrl = '',
  [string]$FailoverWorkerBaseUrl = '',
  [int]$TimeoutSeconds = 15,
  [switch]$SkipPrometheusTargetCheck,
  [switch]$SkipRollbackEvidenceCheck,
  [switch]$SkipDnsCheck
)

$ErrorActionPreference = 'Stop'

function Json($value) {
  return ($value | ConvertTo-Json -Depth 100)
}

function Is-Placeholder([string]$value) {
  if (-not $value) { return $false }
  $trimmed = $value.Trim()
  if (-not $trimmed) { return $false }
  if ($trimmed -eq '...') { return $true }
  if ($trimmed -match '^<[^>]+>$') { return $true }
  if ($trimmed -eq 'REQUIRED') { return $true }
  return $false
}

function Normalize-AbsoluteUrl {
  param(
    [string]$Value,
    [string]$ParamName
  )

  if (-not $Value -or -not $Value.Trim() -or (Is-Placeholder $Value)) {
    throw "$ParamName must be a real absolute URL (http/https). Placeholder values like '...' are not allowed."
  }

  $trimmed = $Value.Trim()
  $uri = $null
  $isAbsolute = [System.Uri]::TryCreate(
    $trimmed,
    [System.UriKind]::Absolute,
    [ref]$uri
  )

  if (-not $isAbsolute -or $null -eq $uri -or -not $uri.Host) {
    throw "$ParamName is not a valid absolute URL: $trimmed"
  }
  if ($uri.Scheme -ne 'http' -and $uri.Scheme -ne 'https') {
    throw "$ParamName must use http or https scheme: $trimmed"
  }

  return $trimmed.TrimEnd('/')
}

function Slug([string]$value) {
  if (-not $value) { return 'item' }
  $normalized = ($value.ToLowerInvariant() -replace '[^a-z0-9]+', '-').Trim('-')
  if (-not $normalized) { return 'item' }
  return $normalized
}

function New-RunDirectory {
  param(
    [string]$Root,
    [string]$Label
  )

  $startedUtc = (Get-Date).ToUniversalTime()
  $runId = $startedUtc.ToString('yyyyMMddTHHmmssZ')
  $resolvedRoot = if ([System.IO.Path]::IsPathRooted($Root)) {
    $Root
  } else {
    [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot $Root))
  }

  New-Item -ItemType Directory -Path $resolvedRoot -Force | Out-Null
  $runDir = Join-Path $resolvedRoot ("{0}-{1}-{2}" -f $startedUtc.ToString('yyyy-MM-dd'), (Slug $Label), $runId)
  New-Item -ItemType Directory -Path $runDir -Force | Out-Null

  return @{
    startedUtc = $startedUtc
    runId = $runId
    runDir = $runDir
  }
}

function Get-ScenarioArtifactPath {
  param(
    [string]$RunDir,
    [string]$Scenario,
    [string]$StepName
  )

  $scenarioDir = Join-Path $RunDir (Slug $Scenario)
  New-Item -ItemType Directory -Path $scenarioDir -Force | Out-Null

  if (-not $script:stepIndex.ContainsKey($Scenario)) {
    $script:stepIndex[$Scenario] = 0
  }
  $script:stepIndex[$Scenario] = [int]$script:stepIndex[$Scenario] + 1
  $step = [int]$script:stepIndex[$Scenario]

  return Join-Path $scenarioDir ("{0:D2}-{1}.json" -f $step, (Slug $StepName))
}

function Save-StepArtifact {
  param(
    [string]$RunDir,
    [string]$Scenario,
    [string]$StepName,
    [hashtable]$Record
  )

  $artifact = Get-ScenarioArtifactPath -RunDir $RunDir -Scenario $Scenario -StepName $StepName
  (Json $Record) | Set-Content -Path $artifact -Encoding utf8

  if (-not $script:artifacts.ContainsKey($Scenario)) {
    $script:artifacts[$Scenario] = @()
  }
  $script:artifacts[$Scenario] += $artifact
  return $artifact
}

function Invoke-Scenario {
  param(
    [string]$Name,
    [scriptblock]$Work,
    [switch]$Skip
  )

  $startedAt = (Get-Date).ToUniversalTime()
  if ($Skip) {
    $script:results += @{
      name = $Name
      status = 'SKIP'
      notes = 'Scenario skipped by configuration.'
      startedAtUtc = $startedAt.ToString('o')
      finishedAtUtc = (Get-Date).ToUniversalTime().ToString('o')
      artifactCount = 0
    }
    return
  }

  Write-Host ''
  Write-Host "Scenario: $Name" -ForegroundColor Cyan
  try {
    & $Work
    $script:results += @{
      name = $Name
      status = 'PASS'
      notes = ''
      startedAtUtc = $startedAt.ToString('o')
      finishedAtUtc = (Get-Date).ToUniversalTime().ToString('o')
      artifactCount = ($script:artifacts[$Name] | Measure-Object).Count
    }
    Write-Host "PASS: $Name" -ForegroundColor Green
  } catch {
    $message = $_.Exception.Message
    if ($_.ScriptStackTrace) {
      $message = "$message | $($_.ScriptStackTrace)"
    }
    $script:results += @{
      name = $Name
      status = 'FAIL'
      notes = $message
      startedAtUtc = $startedAt.ToString('o')
      finishedAtUtc = (Get-Date).ToUniversalTime().ToString('o')
      artifactCount = ($script:artifacts[$Name] | Measure-Object).Count
    }
    $script:failures += ('{0}: {1}' -f $Name, $message)
    Write-Host "FAIL: $Name - $message" -ForegroundColor Red
  }
}

function Invoke-ScriptStep {
  param(
    [string]$RunDir,
    [string]$Scenario,
    [string]$StepName,
    [string]$ScriptPath,
    [hashtable]$ScriptArgs
  )

  $startedAt = (Get-Date).ToUniversalTime()
  $output = @()
  $ok = $true
  try {
    $output = & $ScriptPath @ScriptArgs 2>&1 | ForEach-Object { $_.ToString() }
  } catch {
    $ok = $false
    $output += $_.Exception.Message
    if ($_.ScriptStackTrace) {
      $output += $_.ScriptStackTrace
    }
  }
  $finishedAt = (Get-Date).ToUniversalTime()

  $artifact = Save-StepArtifact -RunDir $RunDir -Scenario $Scenario -StepName $StepName -Record @{
    timestampUtc = $finishedAt.ToString('o')
    startedAtUtc = $startedAt.ToString('o')
    step = $StepName
    scriptPath = $ScriptPath
    arguments = $ScriptArgs
    status = if ($ok) { 'PASS' } else { 'FAIL' }
    output = $output
  }

  if (-not $ok) {
    throw "Step failed: $StepName (artifact: $artifact)"
  }
}

function Parse-UtcDate([string]$value) {
  if (-not $value -or -not $value.Trim() -or (Is-Placeholder $value)) {
    return $null
  }
  $parsed = [DateTime]::MinValue
  $ok = [DateTime]::TryParse(
    $value,
    [System.Globalization.CultureInfo]::InvariantCulture,
    [System.Globalization.DateTimeStyles]::AdjustToUniversal,
    [ref]$parsed
  )
  if (-not $ok) {
    throw "Unable to parse UTC timestamp: $value"
  }
  return $parsed.ToUniversalTime()
}

$ApiBaseUrl = Normalize-AbsoluteUrl -Value $ApiBaseUrl -ParamName 'ApiBaseUrl'
$WorkerBaseUrl = Normalize-AbsoluteUrl -Value $WorkerBaseUrl -ParamName 'WorkerBaseUrl'

if (-not $SkipPrometheusTargetCheck) {
  if ($PrometheusBaseUrl -and $PrometheusBaseUrl.Trim() -and -not (Is-Placeholder $PrometheusBaseUrl)) {
    $PrometheusBaseUrl = Normalize-AbsoluteUrl -Value $PrometheusBaseUrl -ParamName 'PrometheusBaseUrl'
  } else {
    $SkipPrometheusTargetCheck = $true
    Write-Host 'WARN: PrometheusBaseUrl not provided or placeholder-like. Skipping Prometheus target checks.' -ForegroundColor Yellow
  }
}

$hasFailoverApi = ($FailoverApiBaseUrl -and $FailoverApiBaseUrl.Trim() -and -not (Is-Placeholder $FailoverApiBaseUrl))
$hasFailoverWorker = ($FailoverWorkerBaseUrl -and $FailoverWorkerBaseUrl.Trim() -and -not (Is-Placeholder $FailoverWorkerBaseUrl))
if ($hasFailoverApi -xor $hasFailoverWorker) {
  throw 'Provide both -FailoverApiBaseUrl and -FailoverWorkerBaseUrl to run failover checks, or omit both to skip.'
}
$canRunFailover = ($hasFailoverApi -and $hasFailoverWorker)

$run = New-RunDirectory -Root $OutputRoot -Label $EnvironmentLabel
$runId = [string]$run.runId
$runDir = [string]$run.runDir
$startedUtc = [DateTime]$run.startedUtc
$targetApiHost = ([System.Uri]$ApiBaseUrl).Host
$targetWorkerHost = ([System.Uri]$WorkerBaseUrl).Host

$script:results = @()
$script:failures = @()
$script:stepIndex = @{}
$script:artifacts = @{}

$launchScript = Join-Path $PSScriptRoot 'launch-gate-check.ps1'
$observabilityScript = Join-Path $PSScriptRoot 'observability-smoke-check.ps1'
$failoverScript = Join-Path $PSScriptRoot 'failover-gate-check.ps1'

Write-Host "Run ID: $runId"
Write-Host "Output: $runDir"
Write-Host "API target: $ApiBaseUrl"
Write-Host "Worker target: $WorkerBaseUrl"

Invoke-Scenario -Name 'Deploy health gate execution' -Work {
  Invoke-ScriptStep -RunDir $runDir -Scenario 'Deploy health gate execution' -StepName 'launch_gate_check' -ScriptPath $launchScript -ScriptArgs @{
    ApiBaseUrl = $ApiBaseUrl
    WorkerBaseUrl = $WorkerBaseUrl
    TimeoutSeconds = $TimeoutSeconds
  }
}

Invoke-Scenario -Name 'Observability smoke execution' -Work {
  $args = @{
    ApiBaseUrl = $ApiBaseUrl
    WorkerBaseUrl = $WorkerBaseUrl
    TimeoutSeconds = $TimeoutSeconds
  }
  if (-not $SkipPrometheusTargetCheck) {
    $args.PrometheusBaseUrl = $PrometheusBaseUrl
  }
  if ($SkipPrometheusTargetCheck) {
    $args.SkipPrometheusTargetCheck = $true
  }
  Invoke-ScriptStep -RunDir $runDir -Scenario 'Observability smoke execution' -StepName 'observability_smoke_check' -ScriptPath $observabilityScript -ScriptArgs $args
}

Invoke-Scenario -Name 'Staging resolution check' -Work {
  $apiIps = @()
  $workerIps = @()
  if (-not $SkipDnsCheck) {
    $apiIps = @(Resolve-DnsName -Name $targetApiHost -ErrorAction Stop | Where-Object { $_.IPAddress } | Select-Object -ExpandProperty IPAddress)
    $workerIps = @(Resolve-DnsName -Name $targetWorkerHost -ErrorAction Stop | Where-Object { $_.IPAddress } | Select-Object -ExpandProperty IPAddress)
    if ($apiIps.Count -eq 0) {
      throw "No DNS A/AAAA records resolved for API host $targetApiHost"
    }
    if ($workerIps.Count -eq 0) {
      throw "No DNS A/AAAA records resolved for worker host $targetWorkerHost"
    }
  }

  [void](Save-StepArtifact -RunDir $runDir -Scenario 'Staging resolution check' -StepName 'dns_resolution' -Record @{
    timestampUtc = (Get-Date).ToUniversalTime().ToString('o')
    step = 'dns_resolution'
    skipDnsCheck = [bool]$SkipDnsCheck
    apiHost = $targetApiHost
    workerHost = $targetWorkerHost
    apiIps = $apiIps
    workerIps = $workerIps
    status = 'PASS'
  })
}

Invoke-Scenario -Name 'Failover gate execution' -Skip:(-not $canRunFailover) -Work {
  $normalizedFailoverApiBaseUrl = Normalize-AbsoluteUrl -Value $FailoverApiBaseUrl -ParamName 'FailoverApiBaseUrl'
  $normalizedFailoverWorkerBaseUrl = Normalize-AbsoluteUrl -Value $FailoverWorkerBaseUrl -ParamName 'FailoverWorkerBaseUrl'
  Invoke-ScriptStep -RunDir $runDir -Scenario 'Failover gate execution' -StepName 'failover_gate_check' -ScriptPath $failoverScript -ScriptArgs @{
    PrimaryApiBaseUrl = $ApiBaseUrl
    PrimaryWorkerBaseUrl = $WorkerBaseUrl
    FailoverApiBaseUrl = $normalizedFailoverApiBaseUrl
    FailoverWorkerBaseUrl = $normalizedFailoverWorkerBaseUrl
    TimeoutSeconds = $TimeoutSeconds
  }
}

Invoke-Scenario -Name 'Rollback drill evidence check' -Skip:$SkipRollbackEvidenceCheck -Work {
  $start = Parse-UtcDate $RollbackStartedAtUtc
  $end = Parse-UtcDate $RollbackCompletedAtUtc
  $owner = if ($RollbackOwner) { $RollbackOwner.Trim() } else { '' }
  $trigger = if ($RollbackTrigger) { $RollbackTrigger.Trim() } else { '' }

  if (-not $trigger) {
    throw 'RollbackTrigger is required to close rollback evidence.'
  }
  if (-not $owner) {
    throw 'RollbackOwner is required to close rollback evidence.'
  }
  if ($null -eq $start -or $null -eq $end) {
    throw 'RollbackStartedAtUtc and RollbackCompletedAtUtc are required in UTC format.'
  }
  if ($end -le $start) {
    throw 'RollbackCompletedAtUtc must be later than RollbackStartedAtUtc.'
  }

  $durationSec = [int][Math]::Round(($end - $start).TotalSeconds)
  [void](Save-StepArtifact -RunDir $runDir -Scenario 'Rollback drill evidence check' -StepName 'rollback_record' -Record @{
    timestampUtc = (Get-Date).ToUniversalTime().ToString('o')
    trigger = $trigger
    owner = $owner
    startedAtUtc = $start.ToString('o')
    completedAtUtc = $end.ToString('o')
    durationSec = $durationSec
    status = 'PASS'
  })
}

$finishedUtc = (Get-Date).ToUniversalTime()
$scenarioIndex = @{}
foreach ($result in $script:results) {
  $scenarioIndex[$result.name] = $result.status
}

$isProdHost = ($targetApiHost -ieq 'api.evzonecharging.com')
$hasDashboardEvidence = ($DashboardEvidenceLinks | Where-Object { $_ -and $_.Trim() }).Count -gt 0

$requiredActions = @(
  @{
    action = 'Run launch gate and observability smoke against the target environment'
    status = if ($scenarioIndex['Deploy health gate execution'] -eq 'PASS' -and $scenarioIndex['Observability smoke execution'] -eq 'PASS') { 'GREEN' } else { 'RED' }
    notes = 'Artifacts captured from launch-gate-check.ps1 and observability-smoke-check.ps1.'
  },
  @{
    action = 'Use a reproducible non-production verification target'
    status = if ($scenarioIndex['Staging resolution check'] -eq 'PASS' -and -not $isProdHost) { 'GREEN' } else { 'RED' }
    notes = if ($isProdHost) { 'API target host is production.' } else { 'DNS and reachability checks completed for non-production target.' }
  },
  @{
    action = 'Attach dated rollback drill evidence with trigger, owner, and recovery duration'
    status = if ($scenarioIndex['Rollback drill evidence check'] -eq 'PASS') { 'GREEN' } else { 'RED' }
    notes = 'Rollback evidence is recorded as a structured artifact in this run folder.'
  },
  @{
    action = 'Attach dashboard or alert evidence links for reliability signoff'
    status = if ($hasDashboardEvidence) { 'GREEN' } else { 'RED' }
    notes = if ($hasDashboardEvidence) { ($DashboardEvidenceLinks -join '; ') } else { 'Provide dashboard/alert links via -DashboardEvidenceLinks.' }
  }
)

$summary = @{
  runId = $runId
  startedAtUtc = $startedUtc.ToString('o')
  finishedAtUtc = $finishedUtc.ToString('o')
  environmentLabel = $EnvironmentLabel
  apiBaseUrl = $ApiBaseUrl
  workerBaseUrl = $WorkerBaseUrl
  prometheusBaseUrl = if ($SkipPrometheusTargetCheck) { 'SKIPPED' } else { $PrometheusBaseUrl }
  backendCommitRef = if ($BackendCommitRef) { $BackendCommitRef } else { 'UNSPECIFIED' }
  scenarioResults = $script:results
  requiredActions = $requiredActions
  failures = $script:failures
}

$summaryJsonPath = Join-Path $runDir 'run-summary.json'
$summaryMdPath = Join-Path $runDir 'run-summary.md'
(Json $summary) | Set-Content -Path $summaryJsonPath -Encoding utf8

$markdown = @(
  '# Q1 Reliability Evidence Run Summary',
  '',
  "Run ID: $runId",
  "Started (UTC): $($startedUtc.ToString('o'))",
  "Finished (UTC): $($finishedUtc.ToString('o'))",
  "Environment label: $EnvironmentLabel",
  "API target: $ApiBaseUrl",
  "Worker target: $WorkerBaseUrl",
  "Prometheus target: $(if ($SkipPrometheusTargetCheck) { 'SKIPPED' } else { $PrometheusBaseUrl })",
  "Backend commit ref: $(if ($BackendCommitRef) { $BackendCommitRef } else { 'UNSPECIFIED' })",
  '',
  '## Scenario Results',
  '',
  '| Scenario | Status | Artifacts | Notes |',
  '|---|---|---:|---|'
)
foreach ($result in $script:results) {
  $markdown += "| $($result.name) | $($result.status) | $($result.artifactCount) | $(([string]$result.notes) -replace '\|','/') |"
}

$markdown += ''
$markdown += '## Required Actions'
$markdown += ''
$markdown += '| Action | Status | Notes |'
$markdown += '|---|---|---|'
foreach ($action in $requiredActions) {
  $markdown += "| $($action.action) | $($action.status) | $(([string]$action.notes) -replace '\|','/') |"
}

$markdown += ''
$markdown += "Summary JSON: $summaryJsonPath"
($markdown -join "`r`n") | Set-Content -Path $summaryMdPath -Encoding utf8

Write-Host "Summary: $summaryMdPath"

$failedScenarios = @($script:results | Where-Object { $_.status -eq 'FAIL' })
$openRequiredActions = @($requiredActions | Where-Object { $_.status -ne 'GREEN' })

if ($failedScenarios.Count -gt 0) {
  Write-Error 'One or more reliability scenarios failed.'
}
if ($openRequiredActions.Count -gt 0) {
  Write-Error ('Required actions not all GREEN: ' + (($openRequiredActions | ForEach-Object { $_.action }) -join '; '))
}

Write-Host 'All required actions are GREEN for this reliability run.' -ForegroundColor Green
