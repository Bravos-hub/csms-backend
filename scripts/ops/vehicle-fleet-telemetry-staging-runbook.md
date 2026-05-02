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

For environments with self-signed TLS:

```bash
pnpm run ops:vehicles:fleet-telemetry:verify -- --strict true --insecure-ssl true
```

`strict=true` returns exit code `1` while any required check is still failing. If step 3 fails, proceed to step 4 to run the safe data backfill, then re-run verification in step 5 after the backfill is complete.

## 4) Apply safe data backfill

Run this step only when step 3 detects missing or incomplete telemetry data, schema drift, or other failed checks. If step 3 reports all checks passed and no missing data is found, step 4 is optional and should be skipped.

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

For self-signed TLS:

```bash
pnpm run ops:vehicles:fleet-telemetry:verify -- --strict true --insecure-ssl true
```

This final verification is a hard gate when backfill was applied and must be run to confirm post-backfill consistency. If step 3 passed with no missing data and step 4 was skipped, this step can be treated as optional, though it is still recommended before feature-flag enablement.
