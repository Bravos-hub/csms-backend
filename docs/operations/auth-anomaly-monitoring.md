# Auth Anomaly Monitoring

This runbook describes the in-process anomaly monitor for abuse-prone auth routes.

## Covered Routes

- `POST /api/v1/auth/login`
- `POST /api/v1/auth/service/token`
- `POST /api/v1/auth/otp/send`
- `POST /api/v1/auth/otp/verify`
- `POST /api/v1/auth/password/reset`
- `POST /api/v1/auth/refresh`

## Signals

The monitor tracks failures in a rolling 10-minute window by:

- source IP
- device header (`x-device-id` or `x-client-device-id`)
- identifier hash (email/phone/clientId hash)

Default anomaly thresholds:

- IP failures: `>= 20`
- device failures: `>= 12`
- identifier failures: `>= 8`

When a threshold is breached, the API emits a structured warning log:

- `event=auth_anomaly_detected`
- dimension (`ip|device|identifier`)
- route, count in window, and contextual metadata

## Operational Endpoint

Authenticated summary endpoint:

- `GET /api/v1/auth/anomaly/summary`

Use this to inspect:

- per-route success/failure totals
- anomaly totals by dimension
- current number of tracked identities in memory

## Notes

- This monitor is process-local; totals reset on restart.
- For multi-instance deployments, aggregate logs and metrics centrally.
