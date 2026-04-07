# Local Observability Setup (Prometheus + Grafana)

Use this runbook to boot, validate, and troubleshoot the local observability stack after major backend changes.

## Scope

This setup provides:

- local Prometheus + Grafana via Docker Compose
- auto-provisioned Grafana datasource (`DS_PROMETHEUS`)
- auto-provisioned dashboard from `ops/dashboards/launch-command-center.grafana.json`
- local alert rule loading from `ops/observability/prometheus/rules/launch-alerts.yml`
- one-command wiring validation via `npm run ops:obs:smoke`

## Prerequisites

1. Docker Desktop (or Docker Engine + Compose plugin) is installed and running.
2. API is running and reachable at `http://localhost:3000`.
3. Worker is running and reachable at `http://localhost:3010`.

Recommended local terminals:

```powershell
npm run start:api
```

```powershell
npm run start:worker
```

## Start Observability Stack

```powershell
npm run ops:obs:up
```

Check containers:

```powershell
npm run ops:obs:status
```

View logs:

```powershell
npm run ops:obs:logs
```

## Access URLs

- Grafana: `http://localhost:3001`
- Prometheus: `http://localhost:9090`
- Grafana default login: `admin` / `admin`

## Provisioning Behavior

Provisioning files are loaded automatically on startup:

- datasource: `ops/observability/grafana/provisioning/datasources/prometheus.yml`
- dashboards provider: `ops/observability/grafana/provisioning/dashboards/dashboards.yml`
- Prometheus scrape config: `ops/observability/prometheus/prometheus.yml`
- Prometheus alert rules: `ops/observability/prometheus/rules/launch-alerts.yml`

Scrape targets expected by default:

- API: `host.docker.internal:3000/health/metrics/prometheus`
- Worker: `host.docker.internal:3010/metrics/prometheus`

## Run Observability Smoke Check

Default check:

```powershell
npm run ops:obs:smoke
```

Alias:

```powershell
npm run ops:observability:smoke
```

Custom endpoints:

```powershell
powershell -ExecutionPolicy Bypass -File ./scripts/ops/observability-smoke-check.ps1 `
  -ApiBaseUrl http://localhost:3000 `
  -WorkerBaseUrl http://localhost:3010 `
  -PrometheusBaseUrl http://localhost:9090
```

Skip Prometheus target API check (only app endpoint checks):

```powershell
powershell -ExecutionPolicy Bypass -File ./scripts/ops/observability-smoke-check.ps1 -SkipPrometheusTargetCheck
```

## CI Automation

Observability validation is also automated in GitHub Actions:

- `.github/workflows/observability-smoke.yml`

The workflow provisions Postgres + Kafka, starts API/worker, starts local
Prometheus/Grafana stack, and runs the same smoke-check script.
## Expected Success Signals

1. `GET /health/ready` returns `status: ok` for API and worker.
2. API and worker Prometheus metric endpoints return text format metrics.
3. Required metric names are present.
4. Prometheus `/api/v1/targets` reports API and worker targets as `up`.

## Troubleshooting

### `docker` or `docker compose` command not found

- Install Docker Desktop.
- Restart terminal after installation.
- Confirm with `docker --version` and `docker compose version`.

### Worker target is down or connection refused

- Ensure worker is running: `npm run start:worker`.
- Confirm `WORKER_PORT` in `.env` matches Prometheus target (`3010` by default).
- Check worker readiness directly: `http://localhost:3010/health/ready`.

### API target is down

- Ensure API is running: `npm run start:api`.
- Confirm API health endpoint: `http://localhost:3000/health/ready`.
- Confirm metrics endpoint: `http://localhost:3000/health/metrics/prometheus`.

### Grafana opens but dashboard is missing

- Restart Grafana container: `npm run ops:obs:down` then `npm run ops:obs:up`.
- Check provider path in `dashboards.yml` points to `/var/lib/grafana/dashboards`.
- Confirm dashboard file exists: `ops/dashboards/launch-command-center.grafana.json`.

### Smoke check fails on optional worker metrics

- Optional metrics may be absent if there is no command/outbox traffic yet.
- Generate traffic or run worker workloads, then rerun smoke check.

### Prometheus up, but `targets` reports `down`

- Open `http://localhost:9090/targets` and inspect `last error`.
- Validate host ports and local firewall/antivirus behavior.
- If app runs on non-default ports, update `ops/observability/prometheus/prometheus.yml`.

## Stop / Reset

Stop stack:

```powershell
npm run ops:obs:down
```

If needed, remove persisted volumes for a clean reset:

```powershell
docker volume rm evzone-backend_prometheus_data evzone-backend_grafana_data
```

(Volume names may vary by project directory name. Check with `docker volume ls`.)
