# Event Contract Compatibility Policy

This policy governs command/event payload compatibility between backend worker and OCPP gateway.

## Schema Version

- Contract field: `schemaVersion`
- Current version: `1.0`

## Compatibility Rules

1. Producers must emit `schemaVersion`.
2. Consumers must accept:
   - current supported versions
   - legacy payloads without `schemaVersion` (temporary backward compatibility)
3. Consumers must reject unsupported versions with explicit logging/metrics.
4. Breaking changes require a new schema version and dual-read transition period.

## Change Process

1. Add new version to supported list in both producer and consumer repos.
2. Deploy consumers before producers for new versions.
3. Track invalid-version counters during rollout.
4. Remove legacy/no-version support only after all producers are confirmed upgraded.
