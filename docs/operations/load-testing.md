# Load Testing Gates

This project includes k6 templates for the launch quality gates.

## Prerequisites

- Install k6 locally: https://k6.io/docs/get-started/installation/
- Set `BASE_URL` to the target API host.

## Scenarios

1. Baseline (1x expected launch load, 60m):
   - `npm run loadtest:baseline`
2. Stress (2x expected launch load, 30m):
   - `npm run loadtest:stress`
3. Spike (5x burst + recovery):
   - `npm run loadtest:spike`
4. Soak (12h sustained):
   - `npm run loadtest:soak`

## Examples

```bash
BASE_URL=https://staging-api.evzonecharging.com npm run loadtest:baseline
BASE_URL=https://staging-api.evzonecharging.com VUS=120 npm run loadtest:stress
BASE_URL=https://staging-api.evzonecharging.com BASELINE_VUS=80 SPIKE_VUS=400 npm run loadtest:spike
BASE_URL=https://staging-api.evzonecharging.com VUS=100 DURATION=12h npm run loadtest:soak
```

## Gate Policy

Fail release if any scenario breaches configured thresholds for:

- error rate (`http_req_failed`)
- latency (`http_req_duration` p95/p99)

During each run, monitor launch dashboard panels from:
`ops/dashboards/launch-command-center.grafana.json`
