# Dead-Letter Replay

Use this runbook to safely replay command outbox rows that reached `DeadLettered`.

## Script

`scripts/replay-dead-letters.ts`

## Default Safety

- dry-run is enabled by default
- batch size defaults to 100
- replay requires explicit `--dry-run false`

## Usage

Dry-run all dead-lettered rows:

```bash
npm run replay:dead-letters
```

Apply replay (bounded):

```bash
npm run replay:dead-letters -- --dry-run false --limit 100
```

Replay a single command:

```bash
npm run replay:dead-letters -- --dry-run false --command-id <command_id>
```

Replay only older rows:

```bash
npm run replay:dead-letters -- --dry-run false --older-than-minutes 30
```

## Behavior

For each selected outbox row:

1. Set outbox status to `Queued`
2. Reset attempts/lock/publish/error fields
3. Set command status back to `Queued`
4. Write a `CommandEvent` with status `ReplayRequested`
