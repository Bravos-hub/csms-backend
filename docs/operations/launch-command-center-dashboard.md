# Launch Command Center Dashboard

Dashboard template:

- `ops/dashboards/launch-command-center.grafana.json`

Local stack setup and validation runbook:

- `docs/operations/observability-local-setup.md`

## Scope

The dashboard template is aligned to launch SLO monitoring for:

- readiness (API + worker)
- API latency and 5xx ratio
- worker lag/backlog/oldest queued age
- outbox throughput, retries, and dead-letter pressure

## Import

1. Open Grafana and import:
   `ops/dashboards/launch-command-center.grafana.json`
2. Bind `DS_PROMETHEUS` to your Prometheus datasource.
3. Ensure Prometheus is scraping:
   - API: `/health/metrics/prometheus`
   - Worker: `/metrics/prometheus`

## Required Metrics

The template expects these series (or equivalent recording rules):

- `api_health_ready_status`
- `worker_health_ready_status`
- `command_events_consumer_lag_total`
- `outbox_backlog_depth`
- `outbox_oldest_queued_age_seconds`
- `outbox_publish_success_total`
- `outbox_publish_fail_total`
- `outbox_retry_scheduled_total`
- `outbox_dead_letter_total`
- `command_events_failed_total`
- `api_http_requests_total`
- `api_http_requests_status_class_total`
- `api_http_route_latency_ms_p95`
- `api_http_route_latency_ms_p99`

If your metric names differ, update panel queries after import.

## Alert Alignment

Panel thresholds should align with `ops/alerts/launch-alerts.example.yaml`:

- consumer lag p95 `> 10s`
- outbox backlog `> 10000`
- outbox oldest queued age `> 600s`
- dead-letter spikes over short windows

## Drill Usage

Use this dashboard during:

- load tests in `docs/operations/load-testing.md`
- game-day exercises in `docs/operations/game-day-drill.md`
- active launch monitoring and rollback decisions
