param(
  [Parameter(Mandatory = $true)]
  [string]$ApiBaseUrl,
  [string]$EnvironmentLabel = 'staging',
  [string]$OutputRoot = '..\..\..\docs\signoff-evidence\2026-q2\04-commercial\runs',
  [string]$BackendCommitRef = '',
  [string]$AdminEmail = '',
  [string]$AdminPassword = '',
  [string]$CommerceOwner = '',
  [string]$OperationsOwner = '',
  [int]$TimeoutSeconds = 20,
  [switch]$SkipDnsCheck
)

$ErrorActionPreference = 'Stop'

if (Get-Alias -Name r -ErrorAction SilentlyContinue) {
  Remove-Item Alias:r -ErrorAction SilentlyContinue
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

function V([string]$value, [string]$envKey) {
  if ($value -and $value.Trim() -and -not (Is-Placeholder $value)) { return $value.Trim() }
  $fromEnv = [Environment]::GetEnvironmentVariable($envKey)
  if ($fromEnv -and $fromEnv.Trim() -and -not (Is-Placeholder $fromEnv)) { return $fromEnv.Trim() }
  return ''
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

function S([string]$value) {
  if (-not $value) { return 'item' }
  $normalized = ($value.ToLowerInvariant() -replace '[^a-z0-9]+', '-').Trim('-')
  if (-not $normalized) { return 'item' }
  return $normalized
}

function J($value) {
  return ($value | ConvertTo-Json -Depth 100)
}

function G($obj, [string]$name) {
  if ($null -eq $obj) { return $null }
  if ($obj -is [System.Collections.IDictionary]) {
    if ($obj.Contains($name)) { return $obj[$name] } else { return $null }
  }
  try { return $obj.$name } catch { return $null }
}

function Decode-JwtPayload {
  param([string]$token)

  if (-not $token -or -not $token.Trim()) { return $null }
  $parts = $token.Split('.')
  if ($parts.Length -lt 2) { return $null }

  $payload = $parts[1].Replace('-', '+').Replace('_', '/')
  switch ($payload.Length % 4) {
    2 { $payload += '==' }
    3 { $payload += '=' }
  }

  try {
    $bytes = [System.Convert]::FromBase64String($payload)
    $json = [System.Text.Encoding]::UTF8.GetString($bytes)
    return ($json | ConvertFrom-Json -Depth 30)
  } catch {
    return $null
  }
}

function Request-Step {
  param(
    [string]$RunDir,
    [string]$Scenario,
    [string]$Step,
    [string]$Method,
    [string]$BaseUrl,
    [string]$Path,
    [hashtable]$Headers = @{},
    [object]$Body = $null,
    [int[]]$Expected = @(200),
    [int]$Timeout = 20
  )

  $scenarioDir = Join-Path $RunDir (S $Scenario)
  New-Item -ItemType Directory -Path $scenarioDir -Force | Out-Null
  if (-not $script:steps.ContainsKey($Scenario)) {
    $script:steps[$Scenario] = 0
  }
  $script:steps[$Scenario] = [int]$script:steps[$Scenario] + 1
  $stepNumber = [int]$script:steps[$Scenario]

  $artifact = Join-Path $scenarioDir ("{0:D2}-{1}.json" -f $stepNumber, (S $Step))
  $url = "$BaseUrl$Path"

  $params = @{
    Uri = $url
    Method = $Method
    TimeoutSec = $Timeout
    Headers = $Headers
  }
  if ((Get-Command Invoke-WebRequest).Parameters.ContainsKey('SkipHttpErrorCheck')) {
    $params.SkipHttpErrorCheck = $true
  }
  if ($null -ne $Body) {
    $params.Body = (J $Body)
    $params.ContentType = 'application/json'
  }

  try {
    $response = Invoke-WebRequest @params
  } catch {
    throw ("Invoke-WebRequest failed (url={0}, method={1}, timeout={2}): {3}" -f $url, $Method, $Timeout, $_.Exception.Message)
  }

  $statusCode = [int]$response.StatusCode
  $rawBody = if ($null -ne $response.Content) { [string]$response.Content } else { '' }
  $parsedBody = $null
  try {
    if ($rawBody.Trim().StartsWith('{') -or $rawBody.Trim().StartsWith('[')) {
      $parsedBody = $rawBody | ConvertFrom-Json -Depth 100
    }
  } catch {}
  if ($null -eq $parsedBody) {
    $parsedBody = $rawBody
  }

  $record = @{
    timestampUtc = (Get-Date).ToUniversalTime().ToString('o')
    scenario = $Scenario
    step = $Step
    request = @{
      method = $Method
      path = $Path
      headers = $Headers
      body = $Body
    }
    response = @{
      statusCode = $statusCode
      body = $parsedBody
    }
    expected = $Expected
  }
  (J $record) | Set-Content -Path $artifact -Encoding utf8

  if (-not $script:artifacts.ContainsKey($Scenario)) {
    $script:artifacts[$Scenario] = @()
  }
  $script:artifacts[$Scenario] += $artifact

  if ($Expected -notcontains $statusCode) {
    throw ("Unexpected status for {0} {1}: {2}" -f $Method, $Path, $statusCode)
  }

  return @{
    code = $statusCode
    body = $parsedBody
    artifact = $artifact
  }
}

function Scenario {
  param(
    [string]$Name,
    [scriptblock]$Work
  )

  Write-Host ''
  Write-Host "Scenario: $Name" -ForegroundColor Cyan
  $startedAt = (Get-Date).ToUniversalTime()
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

$ApiBaseUrl = Normalize-AbsoluteUrl -Value $ApiBaseUrl -ParamName 'ApiBaseUrl'
$AdminEmail = V $AdminEmail 'Q1_GATE_ADMIN_EMAIL'
$AdminPassword = V $AdminPassword 'Q1_GATE_ADMIN_PASSWORD'
$CommerceOwner = V $CommerceOwner 'Q1_GATE_COMMERCE_OWNER'
$OperationsOwner = V $OperationsOwner 'Q1_GATE_OPERATIONS_OWNER'

$script:results = @()
$script:failures = @()
$script:steps = @{}
$script:artifacts = @{}

$startedUtc = (Get-Date).ToUniversalTime()
$runId = $startedUtc.ToString('yyyyMMddTHHmmssZ')
$outputRootPath = if ([System.IO.Path]::IsPathRooted($OutputRoot)) {
  $OutputRoot
} else {
  [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot $OutputRoot))
}

New-Item -ItemType Directory -Path $outputRootPath -Force | Out-Null
$runDir = Join-Path $outputRootPath ("{0}-{1}-{2}" -f $startedUtc.ToString('yyyy-MM-dd'), (S $EnvironmentLabel), $runId)
New-Item -ItemType Directory -Path $runDir -Force | Out-Null

$targetHost = ([System.Uri]$ApiBaseUrl).Host
$isProd = $targetHost -ieq 'api.evzonecharging.com'
$script:adminToken = ''
$script:adminUserId = ''
$script:commercialIntentId = ''

Write-Host "Target: $ApiBaseUrl"
Write-Host "Output: $runDir"
if ($isProd) {
  Write-Host 'WARN: target is production host.' -ForegroundColor Yellow
}

Scenario 'Preflight and endpoint reachability' {
  if (-not $SkipDnsCheck) {
    $ips = @(
      Resolve-DnsName -Name $targetHost -ErrorAction Stop |
        Where-Object { $_.IPAddress } |
        Select-Object -ExpandProperty IPAddress
    )
    if ($ips.Count -eq 0) {
      throw "DNS resolution failed for $targetHost"
    }
  }

  [void](Request-Step -RunDir $runDir -Scenario 'Preflight and endpoint reachability' -Step 'health' -Method 'GET' -BaseUrl $ApiBaseUrl -Path '/health' -Expected @(200) -Timeout $TimeoutSeconds)
  [void](Request-Step -RunDir $runDir -Scenario 'Preflight and endpoint reachability' -Step 'health_ready' -Method 'GET' -BaseUrl $ApiBaseUrl -Path '/health/ready' -Expected @(200) -Timeout $TimeoutSeconds)
}

if (-not $AdminEmail -or -not $AdminPassword) {
  throw 'Admin credentials are required. Provide -AdminEmail/-AdminPassword or set Q1_GATE_ADMIN_EMAIL/Q1_GATE_ADMIN_PASSWORD.'
}

Scenario 'Tariff and settlement baseline regression' {
  $login = Request-Step -RunDir $runDir -Scenario 'Tariff and settlement baseline regression' -Step 'admin_login' -Method 'POST' -BaseUrl $ApiBaseUrl -Path '/api/v1/auth/login' -Body @{
    email = $AdminEmail
    password = $AdminPassword
  } -Expected @(200, 201) -Timeout $TimeoutSeconds

  $script:adminToken = [string](G $login.body 'accessToken')
  if (-not $script:adminToken) {
    throw 'Admin login returned no accessToken.'
  }

  $payload = Decode-JwtPayload -token $script:adminToken
  $script:adminUserId = [string](G $payload 'sub')

  $headers = @{ Authorization = "Bearer $script:adminToken" }
  [void](Request-Step -RunDir $runDir -Scenario 'Tariff and settlement baseline regression' -Step 'list_tariffs' -Method 'GET' -BaseUrl $ApiBaseUrl -Path '/api/v1/tariffs' -Headers $headers -Expected @(200) -Timeout $TimeoutSeconds)
  [void](Request-Step -RunDir $runDir -Scenario 'Tariff and settlement baseline regression' -Step 'list_settlements' -Method 'GET' -BaseUrl $ApiBaseUrl -Path '/api/v1/settlements?limit=20' -Headers $headers -Expected @(200) -Timeout $TimeoutSeconds)
}

Scenario 'Reconciliation spot check' {
  if (-not $script:adminToken) {
    throw 'Admin token missing.'
  }
  $headers = @{ Authorization = "Bearer $script:adminToken" }

  $intent = Request-Step -RunDir $runDir -Scenario 'Reconciliation spot check' -Step 'create_payment_intent' -Method 'POST' -BaseUrl $ApiBaseUrl -Path '/api/v1/wallet/payment-intents' -Headers $headers -Body @{
    amount = 25
    currency = 'USD'
    idempotencyKey = "q1-commercial-intent-$runId"
    correlationId = "q1-commercial-corr-$runId"
    ttlMinutes = 30
  } -Expected @(200, 201) -Timeout $TimeoutSeconds

  $intentId = [string](G $intent.body 'id')
  if (-not $intentId) {
    throw 'Payment intent create returned no id.'
  }
  $script:commercialIntentId = $intentId

  [void](Request-Step -RunDir $runDir -Scenario 'Reconciliation spot check' -Step 'reconcile_settled' -Method 'PATCH' -BaseUrl $ApiBaseUrl -Path "/api/v1/wallet/payment-intents/$intentId/reconcile" -Headers $headers -Body @{
    status = 'SETTLED'
    markSettled = $true
    providerReference = "Q1-COMMERCIAL-$runId"
    note = 'Q1 commercial reconciliation spot check'
  } -Expected @(200) -Timeout $TimeoutSeconds)

  $readBack = Request-Step -RunDir $runDir -Scenario 'Reconciliation spot check' -Step 'get_payment_intent' -Method 'GET' -BaseUrl $ApiBaseUrl -Path "/api/v1/wallet/payment-intents/$intentId" -Headers $headers -Expected @(200) -Timeout $TimeoutSeconds

  if ([string](G $readBack.body 'reconciliationState') -ne 'RECONCILED') {
    throw 'Payment intent reconciliationState is not RECONCILED after reconcile step.'
  }
}

Scenario 'Abuse-control simulation' {
  if (-not $script:adminToken) {
    throw 'Admin token missing.'
  }
  $headers = @{ Authorization = "Bearer $script:adminToken" }
  $guestPayload = @{
    amount = 12.5
    currency = 'USD'
    idempotencyKey = "q1-commercial-guest-$runId"
    correlationId = "q1-commercial-guest-corr-$runId"
    ttlMinutes = 15
    metadata = @{
      source = 'q1-commercial-gate-replay'
      runId = $runId
    }
  }

  $guestFirst = Request-Step -RunDir $runDir -Scenario 'Abuse-control simulation' -Step 'guest_checkout_first' -Method 'POST' -BaseUrl $ApiBaseUrl -Path '/api/v1/wallet/guest-checkout' -Body $guestPayload -Expected @(200, 201) -Timeout $TimeoutSeconds
  $guestSecond = Request-Step -RunDir $runDir -Scenario 'Abuse-control simulation' -Step 'guest_checkout_second_same_idempotency' -Method 'POST' -BaseUrl $ApiBaseUrl -Path '/api/v1/wallet/guest-checkout' -Body $guestPayload -Expected @(200, 201) -Timeout $TimeoutSeconds

  $firstId = [string](G (G $guestFirst.body 'paymentIntent') 'id')
  $secondId = [string](G (G $guestSecond.body 'paymentIntent') 'id')
  if (-not $firstId -or -not $secondId) {
    throw 'Guest checkout responses did not include paymentIntent.id.'
  }
  if ($firstId -ne $secondId) {
    throw "Expected idempotent guest checkout replay to return same payment intent id, but got '$firstId' and '$secondId'."
  }

  [void](Request-Step -RunDir $runDir -Scenario 'Abuse-control simulation' -Step 'lock_wallet' -Method 'POST' -BaseUrl $ApiBaseUrl -Path '/api/v1/wallet/lock' -Headers $headers -Body @{
    reason = "Q1 commercial abuse simulation lock $runId"
  } -Expected @(200, 201) -Timeout $TimeoutSeconds)

  [void](Request-Step -RunDir $runDir -Scenario 'Abuse-control simulation' -Step 'debit_denied_while_locked' -Method 'POST' -BaseUrl $ApiBaseUrl -Path '/api/v1/wallet/debit' -Headers $headers -Body @{
    amount = 1
    idempotencyKey = "q1-commercial-lock-deny-$runId"
    correlationId = "q1-commercial-lock-corr-$runId"
    note = 'Expected denial while wallet is locked'
  } -Expected @(403) -Timeout $TimeoutSeconds)

  [void](Request-Step -RunDir $runDir -Scenario 'Abuse-control simulation' -Step 'unlock_wallet' -Method 'POST' -BaseUrl $ApiBaseUrl -Path '/api/v1/wallet/unlock' -Headers $headers -Expected @(200, 201) -Timeout $TimeoutSeconds)
}

$finishedUtc = (Get-Date).ToUniversalTime()
$failed = @($script:results | Where-Object { $_.status -eq 'FAIL' }).Count -gt 0

$requiredActions = @(
  @{
    action = 'Tariff and settlement baseline regression check'
    status = if (-not $failed -and (($script:results | Where-Object { $_.name -eq 'Tariff and settlement baseline regression' -and $_.status -eq 'PASS' }).Count -gt 0)) { 'GREEN' } else { 'RED' }
    notes = 'Tariff and settlements endpoints were replayed with raw artifacts.'
  },
  @{
    action = 'Reconciliation spot-check with deterministic final state'
    status = if (-not $failed -and (($script:results | Where-Object { $_.name -eq 'Reconciliation spot check' -and $_.status -eq 'PASS' }).Count -gt 0)) { 'GREEN' } else { 'RED' }
    notes = if ($script:commercialIntentId) { "paymentIntentId=$script:commercialIntentId" } else { 'No successful payment intent reconciliation recorded.' }
  },
  @{
    action = 'Abuse-control simulation with denial behavior captured'
    status = if (-not $failed -and (($script:results | Where-Object { $_.name -eq 'Abuse-control simulation' -and $_.status -eq 'PASS' }).Count -gt 0)) { 'GREEN' } else { 'RED' }
    notes = 'Includes guest checkout idempotency replay and locked-wallet denial path.'
  },
  @{
    action = 'Commerce and Operations owner acknowledgement recorded'
    status = if ($CommerceOwner -and $OperationsOwner) { 'GREEN' } else { 'RED' }
    notes = if ($CommerceOwner -and $OperationsOwner) { "commerce=$CommerceOwner; operations=$OperationsOwner" } else { 'Provide -CommerceOwner and -OperationsOwner for signoff traceability.' }
  }
)

$summary = @{
  runId = $runId
  startedAtUtc = $startedUtc.ToString('o')
  finishedAtUtc = $finishedUtc.ToString('o')
  apiBaseUrl = $ApiBaseUrl
  environmentLabel = $EnvironmentLabel
  backendCommitRef = if ($BackendCommitRef) { $BackendCommitRef } else { 'UNSPECIFIED' }
  adminUserId = if ($script:adminUserId) { $script:adminUserId } else { 'UNRESOLVED' }
  scenarioResults = $script:results
  requiredActions = $requiredActions
  failures = $script:failures
}

$summaryJson = Join-Path $runDir 'run-summary.json'
$summaryMd = Join-Path $runDir 'run-summary.md'
(J $summary) | Set-Content -Path $summaryJson -Encoding utf8

$md = @(
  '# Q1 Commercial Gate Replay Summary',
  '',
  "Run ID: $runId",
  "Started (UTC): $($startedUtc.ToString('o'))",
  "Finished (UTC): $($finishedUtc.ToString('o'))",
  "Target: $ApiBaseUrl",
  "Environment label: $EnvironmentLabel",
  "Backend commit ref: $(if ($BackendCommitRef) { $BackendCommitRef } else { 'UNSPECIFIED' })",
  "Admin user id: $(if ($script:adminUserId) { $script:adminUserId } else { 'UNRESOLVED' })",
  '',
  '## Scenario Results',
  '',
  '| Scenario | Status | Artifacts | Notes |',
  '|---|---|---:|---|'
)
foreach ($result in $script:results) {
  $md += "| $($result.name) | $($result.status) | $($result.artifactCount) | $(([string]$result.notes) -replace '\|','/') |"
}

$md += ''
$md += '## Required Actions'
$md += ''
$md += '| Action | Status | Notes |'
$md += '|---|---|---|'
foreach ($action in $requiredActions) {
  $md += "| $($action.action) | $($action.status) | $(([string]$action.notes) -replace '\|','/') |"
}
$md += ''
$md += "Summary JSON: $summaryJson"
($md -join "`r`n") | Set-Content -Path $summaryMd -Encoding utf8

Write-Host "Summary: $summaryMd"

$open = @($requiredActions | Where-Object { $_.status -ne 'GREEN' })
if ($failed) {
  Write-Error 'One or more commercial scenarios failed.'
}
if ($open.Count -gt 0) {
  Write-Error ('Required actions not all green: ' + (($open | ForEach-Object { $_.action }) -join '; '))
}

Write-Host 'All required actions are green for this commercial run.' -ForegroundColor Green
