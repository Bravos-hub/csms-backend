# Command Pipeline Migration Runbook

Use this runbook for safe rollout of migration `20260222090000_command_pipeline_hardening`.

## Purpose

The migration introduces:

- command pipeline hot-path indexes
- FK constraints for `command_outbox.command_id` and `command_events.command_id`

This runbook provides preflight checks, verification, and rollback steps.

## Preflight

1. Ensure `DATABASE_URL` points to the target environment.
2. Run migration safety checks:

```bash
npm run ops:check-command-pipeline-migration
```

Expected:

- `outbox_orphans.count = 0`
- `event_orphans.count = 0`
- no long-running transactions above threshold
- no invalid command FK constraints

Optional non-blocking mode:

```bash
npm run ops:check-command-pipeline-migration -- --strict false
```

## Apply

Apply migrations normally:

```bash
npx prisma migrate deploy
```

## Post-Apply Verification

1. Re-run preflight checker and confirm status is `ok`.
2. Run worker/API readiness checks:

```bash
npm run build
npm test
```

3. Confirm command pipeline health:
   `GET /health/metrics` on worker should show stable outbox backlog and no dead-letter spikes.

## Rollback

If migration causes incident-level impact and rollback is approved:

1. Apply rollback SQL:

```bash
psql "$DATABASE_URL" -f prisma/migrations/20260222090000_command_pipeline_hardening/rollback.sql
```

2. Re-run preflight checker and readiness checks.
3. Follow incident process in `docs/operations/incident-runbooks.md`.
