param(
  [Parameter(Mandatory = $true)]
  [string]$BaseUrl,
  [switch]$SkipSoak,
  [string]$OutputDir = "ops/loadtest/results"
)

$ErrorActionPreference = "Stop"

if (-not (Get-Command k6 -ErrorAction SilentlyContinue)) {
  throw "k6 is not installed or not available on PATH."
}

New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

$scenarios = @(
  @{
    Name = "baseline"
    Script = "ops/loadtest/k6-baseline.js"
    Summary = Join-Path $OutputDir "baseline-summary.json"
  },
  @{
    Name = "stress"
    Script = "ops/loadtest/k6-stress.js"
    Summary = Join-Path $OutputDir "stress-summary.json"
  },
  @{
    Name = "spike"
    Script = "ops/loadtest/k6-spike.js"
    Summary = Join-Path $OutputDir "spike-summary.json"
  }
)

if (-not $SkipSoak) {
  $scenarios += @{
    Name = "soak"
    Script = "ops/loadtest/k6-soak.js"
    Summary = Join-Path $OutputDir "soak-summary.json"
  }
}

$failures = @()

foreach ($scenario in $scenarios) {
  Write-Host "Running $($scenario.Name) gate against $BaseUrl ..."
  $env:BASE_URL = $BaseUrl
  & k6 run $scenario.Script --summary-export $scenario.Summary
  if ($LASTEXITCODE -ne 0) {
    $failures += $scenario.Name
  }
}

Write-Host "Summary files written to: $OutputDir"

if ($failures.Count -gt 0) {
  $failed = $failures -join ", "
  throw "Load-test quality gates failed for: $failed"
}

Write-Host "All load-test quality gates passed."
