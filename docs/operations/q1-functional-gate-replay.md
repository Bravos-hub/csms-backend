# Q1 Functional Gate Replay

This runbook executes the Q1 baseline functional gates and writes a dated
evidence pack with raw request and response snippets.

Script:

- `scripts/ops/q1-functional-gate-replay.ps1`

NPM alias:

- `npm run ops:q1:functional:gates -- ...`

## Purpose

This script is designed to close the three open actions from the Q1 baseline
functional report:

1. Replay against staging or an approved non-production fallback target.
2. Capture backend and frontend commit/version references used for that replay.
3. Attach raw request and response evidence for each locked Q1 scenario.

## Inputs

Required:

- `-ApiBaseUrl`
- `-AdminEmail`
- `-AdminPassword`
- `-ManagerEmail`
- `-ManagerPassword`

Recommended:

- `-BackendCommitRef`
- `-FrontendCommitRef`
- `-DerStationId`

DER fallback mode:

- Preferred: set `-DerZeroHeadroomStationId` and do not mutate profiles.
- Optional: use `-EnableDerProfileMutation` to force positive/zero headroom on
  `-DerStationId` and auto-restore the original profile afterward.

Preflight-only mode:

- `-PreflightOnly`

## Environment Variable Shortcuts

The script can read these values when arguments are omitted:

- `Q1_GATE_ADMIN_EMAIL`
- `Q1_GATE_ADMIN_PASSWORD`
- `Q1_GATE_MANAGER_EMAIL`
- `Q1_GATE_MANAGER_PASSWORD`
- `Q1_GATE_BACKEND_COMMIT`
- `Q1_GATE_FRONTEND_COMMIT`

## Example

```powershell
npm run ops:q1:functional:gates -- `
  -ApiBaseUrl https://staging-api.evzonecharging.com `
  -BackendCommitRef 26b347f `
  -FrontendCommitRef a255bdc `
  -AdminEmail test1@evzonecharging.com `
  -AdminPassword Tests@2099 `
  -ManagerEmail test3@evzonecharging.com `
  -ManagerPassword Tests@2099 `
  -DerStationId st-101 `
  -DerZeroHeadroomStationId st-der-zero
```

## Output

By default, outputs are written under:

- `docs/signoff-evidence/2026-q2/01-functional-gates/runs/<dated-run-folder>/`

Each run folder includes:

- `run-metadata.json`
- `run-summary.json`
- `run-summary.md`
- scenario subfolders with step-level request and response artifacts
