# Vehicle/Fleet + Telemetry Staging Runbook

This runbook applies to migration `20260502190000_vehicle_fleet_telemetry_foundation`.

## 1) Pre-check (no writes)

```bash
pnpm run ops:vehicles:fleet-telemetry:verify
```

If your staging DB uses self-signed TLS:

```bash
pnpm run ops:vehicles:fleet-telemetry:verify -- --insecure-ssl true
```

## 2) Apply schema migration

```bash
pnpm prisma migrate deploy
```

## 3) Verify schema and data again

```bash
pnpm run ops:vehicles:fleet-telemetry:verify -- --strict true
```

`strict=true` returns exit code `1` while any required check is still failing.

## 4) Apply safe data backfill (optional, controlled)

```bash
pnpm run ops:vehicles:fleet-telemetry:apply
```

If self-signed TLS is required:

```bash
pnpm run ops:vehicles:fleet-telemetry:apply -- --insecure-ssl true
```

## 5) Final verification gate

```bash
pnpm run ops:vehicles:fleet-telemetry:verify -- --strict true
```

Proceed to feature-flag enablement only after this gate passes.
