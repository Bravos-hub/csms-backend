# Secret Rotation Runbook

This runbook covers operational rotation for runtime secrets used by EVZone backend.

## Scope

- PostgreSQL credentials and connection URL
- Kafka SASL credentials and TLS CA
- JWT signing secrets (`JWT_SECRET`, `JWT_SERVICE_SECRET`)
- SMTP credentials
- SMS provider credentials (Twilio)
- Redis credentials and TLS CA

## Rotation Principles

1. Rotate in staging first, then production.
2. Prefer dual-valid windows where supported (new + old accepted temporarily).
3. Roll out consumers before producers for shared credentials where possible.
4. Record exact rotation timestamp and operator.

## Pre-Rotation Checklist

1. Confirm rollback owner and maintenance window.
2. Confirm latest build artifact is healthy in staging.
3. Confirm readiness endpoints are green:
   - API: `/health/ready`
   - worker: `/health/ready`
4. Confirm launch alerting is active.

## Procedure

### 1) Generate new secret material

- Use your approved secret manager / KMS.
- Do not place plaintext secrets in repo or shell history.

### 2) Update secret manager entries

- Write new values to the environment-specific secret path.
- For cert rotation, upload replacement CA chain at configured mount path.

### 3) Deploy services with updated secrets

1. Deploy worker first when rotating Kafka/DB credentials.
2. Deploy API next.
3. Confirm startup validation passes (TLS path, rejectUnauthorized, etc.).

### 4) Validate

1. `GET /health/ready` for API and worker returns HTTP `200`.
2. Verify command pipeline lag/backlog is stable.
3. Verify auth flows:
   - login
   - token refresh
   - service token issuance

### 5) Revoke old credentials

- After verification window, revoke old keys/secrets/certs.
- Confirm no connection attempts remain with revoked credentials.

## Rollback

If rotation causes sustained SLO impact:

1. Re-point secret references to previous known-good version.
2. Redeploy worker and API.
3. Confirm readiness and command pipeline recovery.
4. Open incident and capture failed rotation details.
