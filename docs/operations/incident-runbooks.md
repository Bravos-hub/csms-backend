# Incident Runbooks

## High Consumer Lag

Trigger:

- consumer lag p95 `> 10s` for 10 minutes

Actions:

1. Validate Kafka cluster health and partition ISR.
2. Check worker `GET /health/ready` in all regions.
3. Scale worker replicas up.
4. Confirm lag slope is decreasing.
5. If lag persists, reduce non-critical event producers.

## Outbox Backlog Growth

Trigger:

- `outbox_backlog_depth` rising for 15+ minutes
- `outbox_oldest_queued_age_seconds > 600`

Actions:

1. Confirm DB latency and query plans for outbox claim query.
2. Check Kafka publish failure counters.
3. Scale worker replicas and lower outbox batch interval if safe.
4. Inspect dead-letter growth and top error categories.

## Dead-Letter Spike

Trigger:

- `outbox_dead_letter_total` spike over baseline

Actions:

1. Sample dead-letter payloads and group by error category.
2. Validate topic contracts and payload schema.
3. Patch malformed producer paths.
4. Reprocess only remediated dead-letter records using:
   `npm run replay:dead-letters -- --dry-run false --limit 100`

## Worker Startup Failures

Trigger:

- worker crash loop
- `GET /health/live` unavailable after deployment

Actions:

1. Validate required env vars and cert file paths.
2. Validate Kafka topic env contract.
3. Verify DB reachability and TLS policy.
4. Roll back worker image if failure continues.

## API Readiness Degraded

Trigger:

- API `GET /health/ready` returns HTTP `503`

Actions:

1. Identify failing dependency in readiness payload.
2. If DB down, trigger DB incident process.
3. If Kafka optional and only degraded by Kafka, keep API serving and monitor.
4. If user-facing impact exceeds SLO window, initiate rollback or traffic shed.
