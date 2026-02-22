# Launch Rehearsal And Game-Day Drill

## Objective

Validate launch-day readiness for API + worker under load, dependency turbulence, and failover conditions.

## Drill Scenarios

1. Baseline load for 60 minutes at 1x expected peak.
2. Stress load for 30 minutes at 2x expected peak.
3. Spike load for 5 minutes at 5x expected peak, then 10 minute recovery window.
4. Regional failover simulation with primary region traffic drain.
5. Kafka brownout simulation with worker autoscale response.

## Entry Criteria

- Latest production candidate deployed to staging.
- Alerts and dashboard panels live.
- On-call roster and escalation bridge active.

## Exit Criteria

- API availability >= 99.95% across drill window.
- API 5xx < 0.5% during stress and spike windows.
- Command pipeline SLOs hold:
  - enqueue-to-dispatch p95 `< 2s`
  - enqueue-to-final p95 `< 5s`
- No uncontrolled retry or dead-letter storm.

## Recording Template

For each scenario record:

- start and end timestamps
- max p95 latency and p99 latency
- 5xx error rate
- max consumer lag
- max outbox backlog depth
- recovery time to baseline
- owner notes and follow-up actions
