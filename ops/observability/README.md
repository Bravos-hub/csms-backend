# Local Observability Stack

This folder provides a ready-to-run local Prometheus + Grafana stack.

## Start

```powershell
docker compose -f ops/observability/docker-compose.yml up -d
```

## Stop

```powershell
docker compose -f ops/observability/docker-compose.yml down
```

## Defaults

- Grafana: http://localhost:3001
- Prometheus: http://localhost:9090
- Grafana login: `admin` / `admin`

## Expected application endpoints

- API metrics: `http://host.docker.internal:3000/health/metrics/prometheus`
- Worker metrics: `http://host.docker.internal:3010/metrics/prometheus`

If your ports differ, update `ops/observability/prometheus/prometheus.yml`.
