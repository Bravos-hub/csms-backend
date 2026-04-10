param(
  [Parameter(Mandatory = $true)]
  [string]$ApiBaseUrl,
  [string]$EnvironmentLabel = 'staging',
  [string]$OutputRoot = '..\..\..\docs\signoff-evidence\2026-q2\01-functional-gates\runs',
  [string]$BackendCommitRef = '',
  [string]$FrontendCommitRef = '',
  [string]$AdminEmail = '',
  [string]$AdminPassword = '',
  [string]$ManagerEmail = '',
  [string]$ManagerPassword = '',
  [string]$DerStationId = 'st-101',
  [string]$DerZeroHeadroomStationId = '',
  [switch]$EnableDerProfileMutation,
  [switch]$PreflightOnly,
  [int]$TimeoutSeconds = 20,
  [switch]$SkipDnsCheck
)

$ErrorActionPreference = 'Stop'

function V([string]$x, [string]$k) {
  if ($x -and $x.Trim()) { return $x }
  $e = [Environment]::GetEnvironmentVariable($k)
  if ($e -and $e.Trim()) { return $e }
  return ''
}

function S([string]$x) {
  if (-not $x) { return 'item' }
  $v = ($x.ToLowerInvariant() -replace '[^a-z0-9]+', '-').Trim('-')
  if (-not $v) { return 'item' }
  return $v
}

function J($o) { return ($o | ConvertTo-Json -Depth 100) }

function G($obj, [string]$name) {
  if ($null -eq $obj) { return $null }
  if ($obj -is [System.Collections.IDictionary]) {
    if ($obj.Contains($name)) { return $obj[$name] } else { return $null }
  }
  try { return $obj.$name } catch { return $null }
}

function N($obj, [string[]]$path) {
  $cur = $obj
  foreach ($p in $path) { $cur = G $cur $p }
  return $cur
}

function R($runDir, $scenario, $step, $method, $base, $path, $headers, $body, $expected, $timeout) {
  $sd = Join-Path $runDir (S $scenario)
  New-Item -ItemType Directory -Path $sd -Force | Out-Null
  if (-not $script:steps.ContainsKey($scenario)) { $script:steps[$scenario] = 0 }
  $script:steps[$scenario] = [int]$script:steps[$scenario] + 1
  $num = [int]$script:steps[$scenario]
  $artifact = Join-Path $sd ("{0:D2}-{1}.json" -f $num, (S $step))
  $url = "$base$path"

  $p = @{ Uri = $url; Method = $method; TimeoutSec = $timeout; Headers = $headers }
  if ((Get-Command Invoke-WebRequest).Parameters.ContainsKey('SkipHttpErrorCheck')) { $p.SkipHttpErrorCheck = $true }
  if ($null -ne $body) { $p.Body = J $body; $p.ContentType = 'application/json' }
  $resp = Invoke-WebRequest @p
  $code = [int]$resp.StatusCode
  $raw = if ($null -ne $resp.Content) { [string]$resp.Content } else { '' }
  $parsed = $null
  try { if ($raw.Trim().StartsWith('{') -or $raw.Trim().StartsWith('[')) { $parsed = $raw | ConvertFrom-Json -Depth 100 } } catch {}
  if ($null -eq $parsed) { $parsed = $raw }

  $record = @{
    timestampUtc = (Get-Date).ToUniversalTime().ToString('o')
    scenario = $scenario
    step = $step
    request = @{ method = $method; path = $path }
    response = @{ statusCode = $code; body = $parsed }
    expected = $expected
  }
  (J $record) | Set-Content -Path $artifact -Encoding utf8
  if (-not $script:artifacts.ContainsKey($scenario)) { $script:artifacts[$scenario] = @() }
  $script:artifacts[$scenario] += $artifact
  if ($expected -notcontains $code) { throw ("Unexpected status for {0} {1}: {2}" -f $method, $path, $code) }
  return @{ code = $code; body = $parsed; artifact = $artifact }
}

function Scenario([string]$name, [scriptblock]$work) {
  Write-Host ''
  Write-Host "Scenario: $name" -ForegroundColor Cyan
  $start = (Get-Date).ToUniversalTime()
  try {
    & $work
    $script:results += @{ name = $name; status = 'PASS'; notes = ''; startedAtUtc = $start.ToString('o'); finishedAtUtc = (Get-Date).ToUniversalTime().ToString('o'); artifactCount = ($script:artifacts[$name] | Measure-Object).Count }
    Write-Host "PASS: $name" -ForegroundColor Green
  } catch {
    $msg = $_.Exception.Message
    $script:results += @{ name = $name; status = 'FAIL'; notes = $msg; startedAtUtc = $start.ToString('o'); finishedAtUtc = (Get-Date).ToUniversalTime().ToString('o'); artifactCount = ($script:artifacts[$name] | Measure-Object).Count }
    $script:fails += ('{0}: {1}' -f $name, $msg)
    Write-Host "FAIL: $name - $msg" -ForegroundColor Red
  }
}

$ApiBaseUrl = $ApiBaseUrl.Trim().TrimEnd('/')
$AdminEmail = V $AdminEmail 'Q1_GATE_ADMIN_EMAIL'
$AdminPassword = V $AdminPassword 'Q1_GATE_ADMIN_PASSWORD'
$ManagerEmail = V $ManagerEmail 'Q1_GATE_MANAGER_EMAIL'
$ManagerPassword = V $ManagerPassword 'Q1_GATE_MANAGER_PASSWORD'
$BackendCommitRef = V $BackendCommitRef 'Q1_GATE_BACKEND_COMMIT'
$FrontendCommitRef = V $FrontendCommitRef 'Q1_GATE_FRONTEND_COMMIT'

$script:results = @()
$script:fails = @()
$script:steps = @{}
$script:artifacts = @{}
$startedUtc = (Get-Date).ToUniversalTime()
$runId = $startedUtc.ToString('yyyyMMddTHHmmssZ')
$root = if ([System.IO.Path]::IsPathRooted($OutputRoot)) { $OutputRoot } else { [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot $OutputRoot)) }
New-Item -ItemType Directory -Path $root -Force | Out-Null
$runDir = Join-Path $root ("{0}-{1}-{2}" -f $startedUtc.ToString('yyyy-MM-dd'), (S $EnvironmentLabel), $runId)
New-Item -ItemType Directory -Path $runDir -Force | Out-Null

$host = ([System.Uri]$ApiBaseUrl).Host
$isProd = $host -ieq 'api.evzonecharging.com'
Write-Host "Target: $ApiBaseUrl"
Write-Host "Output: $runDir"
if ($isProd) { Write-Host 'WARN: target is production host.' -ForegroundColor Yellow }

Scenario 'Preflight and endpoint reachability' {
  if (-not $SkipDnsCheck) {
    $ips = @(Resolve-DnsName -Name $host -ErrorAction Stop | Where-Object { $_.IPAddress } | Select-Object -ExpandProperty IPAddress)
    if ($ips.Count -eq 0) { throw "DNS resolution failed for $host" }
  }
  [void](R $runDir 'Preflight and endpoint reachability' 'health' 'GET' $ApiBaseUrl '/health' @{} $null @(200) $TimeoutSeconds)
  [void](R $runDir 'Preflight and endpoint reachability' 'health_ready' 'GET' $ApiBaseUrl '/health/ready' @{} $null @(200) $TimeoutSeconds)
}

$adminToken = ''
$managerToken = ''

if (-not $PreflightOnly) {
  if (-not $AdminEmail -or -not $AdminPassword -or -not $ManagerEmail -or -not $ManagerPassword) {
    throw 'Admin and manager credentials are required unless -PreflightOnly is used.'
  }

  Scenario 'OIDC and RBAC gate' {
    $a = R $runDir 'OIDC and RBAC gate' 'admin_login' 'POST' $ApiBaseUrl '/api/v1/auth/login' @{} @{ email = $AdminEmail; password = $AdminPassword } @(200, 201) $TimeoutSeconds
    $adminToken = [string](G $a.body 'accessToken')
    if (-not $adminToken) { throw 'Admin login returned no accessToken.' }
    $m = R $runDir 'OIDC and RBAC gate' 'manager_login' 'POST' $ApiBaseUrl '/api/v1/auth/login' @{} @{ email = $ManagerEmail; password = $ManagerPassword } @(200, 201) $TimeoutSeconds
    $managerToken = [string](G $m.body 'accessToken')
    if (-not $managerToken) { throw 'Manager login returned no accessToken.' }
    [void](R $runDir 'OIDC and RBAC gate' 'admin_enterprise_overview' 'GET' $ApiBaseUrl '/api/v1/enterprise-iam/overview' @{ Authorization = "Bearer $adminToken" } $null @(200) $TimeoutSeconds)
    [void](R $runDir 'OIDC and RBAC gate' 'admin_developer_overview' 'GET' $ApiBaseUrl '/api/v1/platform/developer/v1/overview' @{ Authorization = "Bearer $adminToken" } $null @(200) $TimeoutSeconds)
    [void](R $runDir 'OIDC and RBAC gate' 'manager_enterprise_overview_denied' 'GET' $ApiBaseUrl '/api/v1/enterprise-iam/overview' @{ Authorization = "Bearer $managerToken" } $null @(403) $TimeoutSeconds)
    [void](R $runDir 'OIDC and RBAC gate' 'manager_developer_overview_denied' 'GET' $ApiBaseUrl '/api/v1/platform/developer/v1/overview' @{ Authorization = "Bearer $managerToken" } $null @(403) $TimeoutSeconds)
  }

  Scenario 'Enterprise sync import gate' {
    $h = @{ Authorization = "Bearer $adminToken" }
    $p = R $runDir 'Enterprise sync import gate' 'create_provider' 'POST' $ApiBaseUrl '/api/v1/enterprise-iam/providers' $h @{ name = "q1-gate-provider-$runId"; protocol = 'OIDC'; status = 'ACTIVE'; syncMode = 'MANUAL_IMPORT'; roleMappings = @{ admins = @('EVZONE_ADMIN'); managers = @('MANAGER') } } @(200, 201) $TimeoutSeconds
    $pid = [string](G $p.body 'id'); if (-not $pid) { throw 'Provider creation returned no id.' }
    [void](R $runDir 'Enterprise sync import gate' 'update_role_mappings' 'PUT' $ApiBaseUrl "/api/v1/enterprise-iam/providers/$pid/role-mappings" $h @{ roleMappings = @{ admins = @('EVZONE_ADMIN'); managers = @('MANAGER') } } @(200) $TimeoutSeconds)
    [void](R $runDir 'Enterprise sync import gate' 'sync_import' 'POST' $ApiBaseUrl "/api/v1/enterprise-iam/providers/$pid/sync-import" $h @{ mode = 'APPLY'; includeGroupsOnly = $false; groups = @(@{ name = 'admins'; mappedRoleKey = 'EVZONE_ADMIN' }, @{ name = 'managers'; mappedRoleKey = 'MANAGER' }); users = @(@{ email = "q1-sync-user-$runId@example.com"; displayName = 'Q1 Sync User'; groups = @('managers') }) } @(200, 201) $TimeoutSeconds)
    [void](R $runDir 'Enterprise sync import gate' 'list_sync_jobs' 'GET' $ApiBaseUrl "/api/v1/enterprise-iam/sync-jobs?providerId=$([System.Uri]::EscapeDataString($pid))" $h $null @(200) $TimeoutSeconds)
  }
}

if (-not $PreflightOnly) {
  Scenario 'PnC lifecycle and diagnostics gate' {
    $h = @{ Authorization = "Bearer $adminToken" }
    $c = R $runDir 'PnC lifecycle and diagnostics gate' 'create_contract' 'POST' $ApiBaseUrl '/api/v1/pnc/contracts' $h @{ contractRef = "Q1-GATE-$runId"; status = 'ACTIVE'; metadata = @{ source = 'q1-functional-gate-replay'; runId = $runId } } @(200, 201) $TimeoutSeconds
    $cid = [string](G $c.body 'id'); if (-not $cid) { throw 'Contract create returned no id.' }
    $i = R $runDir 'PnC lifecycle and diagnostics gate' 'issue_certificate' 'POST' $ApiBaseUrl "/api/v1/pnc/contracts/$cid/certificates" $h @{ certificateHash = ([Guid]::NewGuid().ToString('N')); certificateType = 'ISO15118'; validFrom = (Get-Date).ToUniversalTime().ToString('o'); validTo = (Get-Date).ToUniversalTime().AddDays(365).ToString('o') } @(200, 201) $TimeoutSeconds
    $cert = G $i.body 'certificate'; $certId = [string](G $cert 'id'); if (-not $certId) { throw 'Certificate issue returned no certificate.id.' }
    [void](R $runDir 'PnC lifecycle and diagnostics gate' 'diagnostics_before_revoke' 'GET' $ApiBaseUrl "/api/v1/pnc/certificates/$certId/diagnostics" $h $null @(200) $TimeoutSeconds)
    [void](R $runDir 'PnC lifecycle and diagnostics gate' 'revoke_certificate' 'POST' $ApiBaseUrl "/api/v1/pnc/certificates/$certId/revoke" $h @{ reason = 'Q1 gate replay' } @(200, 201) $TimeoutSeconds)
    $after = R $runDir 'PnC lifecycle and diagnostics gate' 'diagnostics_after_revoke' 'GET' $ApiBaseUrl "/api/v1/pnc/certificates/$certId/diagnostics" $h $null @(200) $TimeoutSeconds
    if ([string](N $after.body @('diagnostics', 'status')) -ne 'REVOKED') { throw 'Certificate did not reach REVOKED status.' }
  }

  Scenario 'DER constrained fallback gate' {
    $h = @{ Authorization = "Bearer $adminToken" }
    if ($EnableDerProfileMutation) {
      $cur = R $runDir 'DER constrained fallback gate' 'read_original_der_profile' 'GET' $ApiBaseUrl "/api/v1/energy-management/stations/$DerStationId/der-profile" $h $null @(200) $TimeoutSeconds
      $orig = G $cur.body 'profile'; if ($null -eq $orig) { throw 'Mutation mode requires an existing DER profile.' }
      try {
        [void](R $runDir 'DER constrained fallback gate' 'set_positive_headroom' 'PUT' $ApiBaseUrl "/api/v1/energy-management/stations/$DerStationId/der-profile" $h @{ status = 'ACTIVE'; maxGridImportKw = 200; reserveGridKw = 20; solarEnabled = $true; maxSolarContributionKw = 60; bessEnabled = $true; maxBessDischargeKw = 30; bessSocPercent = 85; bessReserveSocPercent = 20 } @(200) $TimeoutSeconds)
        $normal = R $runDir 'DER constrained fallback gate' 'create_normal_plan' 'POST' $ApiBaseUrl '/api/v1/energy-optimization/plans' $h @{ stationId = $DerStationId; targetEnergyKwh = 20; maxChargeAmps = 32; minChargeAmps = 0; dryRun = $true } @(200, 201) $TimeoutSeconds
        if ([string](G $normal.body 'state') -eq 'FALLBACK_DLM') { throw 'Normal DER plan unexpectedly returned FALLBACK_DLM.' }
        [void](R $runDir 'DER constrained fallback gate' 'set_zero_headroom' 'PUT' $ApiBaseUrl "/api/v1/energy-management/stations/$DerStationId/der-profile" $h @{ status = 'ACTIVE'; maxGridImportKw = 0; reserveGridKw = 0; solarEnabled = $false; maxSolarContributionKw = 0; bessEnabled = $false; maxBessDischargeKw = 0; bessSocPercent = 0; bessReserveSocPercent = 0 } @(200) $TimeoutSeconds)
        $fb = R $runDir 'DER constrained fallback gate' 'create_zero_headroom_plan' 'POST' $ApiBaseUrl '/api/v1/energy-optimization/plans' $h @{ stationId = $DerStationId; targetEnergyKwh = 20; maxChargeAmps = 32; minChargeAmps = 0; dryRun = $true } @(200, 201) $TimeoutSeconds
        if ([string](G $fb.body 'state') -ne 'FALLBACK_DLM' -or [string](G $fb.body 'fallbackReason') -ne 'DER_CONSTRAINT_ZERO_HEADROOM') { throw 'Zero-headroom plan did not produce expected DER fallback.' }
      } finally {
        [void](R $runDir 'DER constrained fallback gate' 'restore_original_der_profile' 'PUT' $ApiBaseUrl "/api/v1/energy-management/stations/$DerStationId/der-profile" $h @{ status = G $orig 'status'; maxGridImportKw = G $orig 'maxGridImportKw'; reserveGridKw = G $orig 'reserveGridKw'; solarEnabled = [bool](G $orig 'solarEnabled'); maxSolarContributionKw = G $orig 'maxSolarContributionKw'; bessEnabled = [bool](G $orig 'bessEnabled'); maxBessDischargeKw = G $orig 'maxBessDischargeKw'; bessSocPercent = G $orig 'bessSocPercent'; bessReserveSocPercent = G $orig 'bessReserveSocPercent'; forecast = G $orig 'forecast'; metadata = G $orig 'metadata' } @(200) $TimeoutSeconds)
      }
    } else {
      if (-not $DerZeroHeadroomStationId) { throw 'Provide -DerZeroHeadroomStationId or enable -EnableDerProfileMutation.' }
      $normal = R $runDir 'DER constrained fallback gate' 'create_normal_plan_no_mutation' 'POST' $ApiBaseUrl '/api/v1/energy-optimization/plans' $h @{ stationId = $DerStationId; targetEnergyKwh = 20; maxChargeAmps = 32; minChargeAmps = 0; dryRun = $true } @(200, 201) $TimeoutSeconds
      if ([string](G $normal.body 'state') -eq 'FALLBACK_DLM') { throw 'Normal station returned FALLBACK_DLM.' }
      $zp = R $runDir 'DER constrained fallback gate' 'read_zero_headroom_station' 'GET' $ApiBaseUrl "/api/v1/energy-management/stations/$DerZeroHeadroomStationId/der-profile" $h $null @(200) $TimeoutSeconds
      $maxA = N $zp.body @('constraints', 'effectiveMaxChargingAmps')
      if ($null -eq $maxA -or [double]$maxA -gt 0) { throw 'Zero-headroom station is not currently zero headroom.' }
      $fb = R $runDir 'DER constrained fallback gate' 'create_zero_headroom_plan_no_mutation' 'POST' $ApiBaseUrl '/api/v1/energy-optimization/plans' $h @{ stationId = $DerZeroHeadroomStationId; targetEnergyKwh = 20; maxChargeAmps = 32; minChargeAmps = 0; dryRun = $true } @(200, 201) $TimeoutSeconds
      if ([string](G $fb.body 'state') -ne 'FALLBACK_DLM' -or [string](G $fb.body 'fallbackReason') -ne 'DER_CONSTRAINT_ZERO_HEADROOM') { throw 'Expected DER fallback was not observed.' }
    }
  }

  Scenario 'Developer app and key lifecycle gate' {
    $h = @{ Authorization = "Bearer $adminToken" }
    $app = R $runDir 'Developer app and key lifecycle gate' 'create_app' 'POST' $ApiBaseUrl '/api/v1/platform/developer/v1/apps' $h @{ name = "Q1 lifecycle app $runId"; defaultRateLimitPerMin = 120 } @(200, 201) $TimeoutSeconds
    $appId = [string](G $app.body 'id'); if (-not $appId) { throw 'App creation returned no id.' }
    $key = R $runDir 'Developer app and key lifecycle gate' 'create_key' 'POST' $ApiBaseUrl "/api/v1/platform/developer/v1/apps/$appId/keys" $h @{ name = "Q1 lifecycle key $runId"; scopes = @('stations.read'); rateLimitPerMin = 120 } @(200, 201) $TimeoutSeconds
    $apiKey = [string](G $key.body 'apiKey'); $keyId = [string](G $key.body 'id')
    if (-not $apiKey -or -not $keyId) { throw 'Key issuance returned no apiKey/id.' }
    [void](R $runDir 'Developer app and key lifecycle gate' 'public_before_revoke' 'GET' $ApiBaseUrl '/api/v1/developer/v1/stations/summary' @{ 'x-api-key' = $apiKey } $null @(200) $TimeoutSeconds)
    [void](R $runDir 'Developer app and key lifecycle gate' 'revoke_key' 'POST' $ApiBaseUrl "/api/v1/platform/developer/v1/keys/$keyId/revoke" $h @{ reason = 'Q1 gate replay' } @(200, 201) $TimeoutSeconds)
    [void](R $runDir 'Developer app and key lifecycle gate' 'public_after_revoke_denied' 'GET' $ApiBaseUrl '/api/v1/developer/v1/stations/summary' @{ 'x-api-key' = $apiKey } $null @(401) $TimeoutSeconds)
  }

  Scenario 'Rate-limit enforcement gate' {
    $h = @{ Authorization = "Bearer $adminToken" }
    $app = R $runDir 'Rate-limit enforcement gate' 'create_rate_app' 'POST' $ApiBaseUrl '/api/v1/platform/developer/v1/apps' $h @{ name = "Q1 rate app $runId"; defaultRateLimitPerMin = 10 } @(200, 201) $TimeoutSeconds
    $appId = [string](G $app.body 'id'); if (-not $appId) { throw 'Rate app creation returned no id.' }
    $key = R $runDir 'Rate-limit enforcement gate' 'create_rate_key' 'POST' $ApiBaseUrl "/api/v1/platform/developer/v1/apps/$appId/keys" $h @{ name = "Q1 rate key $runId"; scopes = @('stations.read'); rateLimitPerMin = 10 } @(200, 201) $TimeoutSeconds
    $apiKey = [string](G $key.body 'apiKey'); $apiKeyId = [string](G $key.body 'id')
    if (-not $apiKey -or -not $apiKeyId) { throw 'Rate key creation returned no apiKey/id.' }
    if ([DateTime]::UtcNow.Second -ge 45) { Start-Sleep -Seconds (62 - [DateTime]::UtcNow.Second) }
    $codes = @()
    for ($i = 1; $i -le 12; $i++) {
      $r = R $runDir 'Rate-limit enforcement gate' ("burst_{0:D2}" -f $i) 'GET' $ApiBaseUrl '/api/v1/developer/v1/stations/summary' @{ 'x-api-key' = $apiKey } $null @(200, 429) $TimeoutSeconds
      $codes += $r.code
    }
    $ok = @($codes | Where-Object { $_ -eq 200 }).Count
    $limited = @($codes | Where-Object { $_ -eq 429 }).Count
    if ($ok -ne 10 -or $limited -ne 2) { throw ("Expected 10x200 + 2x429; got {0}x200 + {1}x429" -f $ok, $limited) }
    Start-Sleep -Seconds 2
    $u = R $runDir 'Rate-limit enforcement gate' 'usage_after_burst' 'GET' $ApiBaseUrl "/api/v1/platform/developer/v1/usage?apiKeyId=$([System.Uri]::EscapeDataString($apiKeyId))&windowHours=1" $h $null @(200) $TimeoutSeconds
    $tot = G $u.body 'totals'
    if ([int](G $tot 'requests') -lt 12 -or [int](G $tot 'denied') -lt 2) { throw 'Usage totals did not reflect expected request/denied counts.' }
  }
}

$finishedUtc = (Get-Date).ToUniversalTime()
$failed = @($script:results | Where-Object { $_.status -eq 'FAIL' }).Count -gt 0
$required = @(
  @{ action = 'Restore or replace staging endpoint with replay target outside production'; status = if (-not $failed -and -not $isProd) { 'GREEN' } else { 'RED' }; notes = if ($isProd) { 'Target is production host.' } else { 'Replay target is non-production.' } },
  @{ action = 'Capture exact backend and frontend commit/version references'; status = if ($BackendCommitRef -and $FrontendCommitRef) { 'GREEN' } else { 'RED' }; notes = if ($BackendCommitRef -and $FrontendCommitRef) { "backend=$BackendCommitRef; frontend=$FrontendCommitRef" } else { 'Provide backend and frontend commit refs.' } },
  @{ action = 'Attach raw request and response snippets for each Q1 scenario under dated run folder'; status = if (-not $failed -and -not $PreflightOnly -and $script:results.Count -ge 6) { 'GREEN' } else { 'RED' }; notes = if ($PreflightOnly) { 'Preflight-only run.' } else { 'See scenario artifacts in run folder.' } }
)

$summary = @{
  runId = $runId
  startedAtUtc = $startedUtc.ToString('o')
  finishedAtUtc = $finishedUtc.ToString('o')
  apiBaseUrl = $ApiBaseUrl
  environmentLabel = $EnvironmentLabel
  preflightOnly = [bool]$PreflightOnly
  backendCommitRef = if ($BackendCommitRef) { $BackendCommitRef } else { 'UNSPECIFIED' }
  frontendCommitRef = if ($FrontendCommitRef) { $FrontendCommitRef } else { 'UNSPECIFIED' }
  scenarioResults = $script:results
  requiredActions = $required
  failures = $script:fails
}
$summaryJson = Join-Path $runDir 'run-summary.json'
$summaryMd = Join-Path $runDir 'run-summary.md'
(J $summary) | Set-Content -Path $summaryJson -Encoding utf8

$md = @(
  '# Q1 Functional Gate Replay Summary',
  '',
  "Run ID: $runId",
  "Started (UTC): $($startedUtc.ToString('o'))",
  "Finished (UTC): $($finishedUtc.ToString('o'))",
  "Target: $ApiBaseUrl",
  "Environment label: $EnvironmentLabel",
  "Backend commit ref: $(if ($BackendCommitRef) { $BackendCommitRef } else { 'UNSPECIFIED' })",
  "Frontend commit ref: $(if ($FrontendCommitRef) { $FrontendCommitRef } else { 'UNSPECIFIED' })",
  '',
  '## Scenario Results',
  '',
  '| Scenario | Status | Artifacts | Notes |',
  '|---|---|---:|---|'
)
foreach ($r in $script:results) { $md += "| $($r.name) | $($r.status) | $($r.artifactCount) | $(([string]$r.notes) -replace '\|','/') |" }
$md += ''
$md += '## Required Actions'
$md += ''
$md += '| Action | Status | Notes |'
$md += '|---|---|---|'
foreach ($a in $required) { $md += "| $($a.action) | $($a.status) | $(([string]$a.notes) -replace '\|','/') |" }
$md += ''
$md += "Summary JSON: $summaryJson"
($md -join "`r`n") | Set-Content -Path $summaryMd -Encoding utf8

Write-Host "Summary: $summaryMd"
$open = @($required | Where-Object { $_.status -ne 'GREEN' })
if ($failed) { Write-Error 'One or more scenarios failed.' }
if ($open.Count -gt 0) { Write-Error ('Required actions not all green: ' + (($open | ForEach-Object { $_.action }) -join '; ')) }
Write-Host 'All required actions are green for this run.' -ForegroundColor Green
