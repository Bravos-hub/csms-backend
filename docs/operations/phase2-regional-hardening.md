# Phase 2 Regional Hardening

This document operationalizes Launch Readiness Phase 2 for EVZone backend.

## 1) Multi-Region Deployment Strategy

Target topology:

- `primary`: `nyc` (active)
- `failover`: second region (active-standby)
- `api` and `worker` deployed in both regions
- regional PostgreSQL strategy:
  - managed primary with cross-region replica
  - promote replica only during regional failover events

Routing strategy:

- DNS health-check based failover for `api.evzonecharging.com`.
- Keep worker traffic region-local to the regional Kafka and DB endpoint.
- Prefer sticky regional routing for API clients where possible.

Readiness gates per region:

- API: `GET /health/ready` must return HTTP `200`.
- Worker: `GET /health/ready` must return HTTP `200`.
- Backlog guardrails:
  - `outbox_backlog_depth < 10000`
  - `outbox_oldest_queued_age_seconds < 600`

## 2) Failover Execution Plan

1. Verify steady-state SLO and backlog health in primary.
2. Confirm standby region is warm:
   - API and worker pods healthy
   - Kafka connectivity healthy
   - DB replica replication lag within policy
3. Shift 10% of traffic to standby region and observe for 15 minutes.
4. If stable, shift 50%, then 100%.
5. Keep old primary warm for rollback window.

Rollback:

1. Re-point DNS/traffic policy to previous primary.
2. Confirm API and worker readiness in restored primary.
3. Reconcile command events/outbox backlog and lag.

## 3) Validation Matrix

- Routing:
  - primary down simulation
  - degraded primary latency simulation
- Dependency:
  - Kafka broker brownout
  - DB latency surge
- Queue:
  - outbox backlog growth + worker autoscale response

Success criteria:

- No sustained API 5xx spike beyond 10 minutes.
- Command pipeline p95 targets hold:
  - enqueue-to-dispatch `< 2s`
  - enqueue-to-final `< 5s`
- Queue lag recovers after failover event.

## 4) Operational Ownership

- Incident commander: on-call backend lead
- Communications: product + support bridge
- Technical owners:
  - API: backend team
  - worker pipeline: backend team
  - OCPP command path: gateway team
