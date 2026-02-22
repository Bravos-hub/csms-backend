import { Client } from 'pg';

type CheckResult = {
  name: string;
  ok: boolean;
  details: Record<string, unknown>;
};

function getArgValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index < 0) return undefined;
  return process.argv[index + 1];
}

function parseIntArg(flag: string, fallback: number): number {
  const raw = getArgValue(flag);
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return parsed;
}

function parseBoolArg(flag: string, fallback: boolean): boolean {
  const raw = getArgValue(flag);
  if (!raw) return fallback;
  const normalized = raw.trim().toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  return fallback;
}

async function getCount(
  client: Client,
  query: string,
  values: unknown[] = [],
): Promise<number> {
  const result = await client.query<{ count: string }>(query, values);
  return Number.parseInt(result.rows[0]?.count ?? '0', 10);
}

async function main() {
  const strict = parseBoolArg('--strict', true);
  const transactionAgeThresholdSeconds = parseIntArg('--xact-age-seconds', 300);

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required.');
  }

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  const checks: CheckResult[] = [];
  let hasUnexpectedError = false;

  try {
    const orphanOutboxCount = await getCount(
      client,
      `
      SELECT COUNT(*)::bigint AS count
      FROM "command_outbox" o
      LEFT JOIN "commands" c ON c."id" = o."command_id"
      WHERE c."id" IS NULL
      `,
    );
    checks.push({
      name: 'outbox_orphans',
      ok: orphanOutboxCount === 0,
      details: { count: orphanOutboxCount },
    });

    const orphanEventCount = await getCount(
      client,
      `
      SELECT COUNT(*)::bigint AS count
      FROM "command_events" e
      LEFT JOIN "commands" c ON c."id" = e."command_id"
      WHERE c."id" IS NULL
      `,
    );
    checks.push({
      name: 'event_orphans',
      ok: orphanEventCount === 0,
      details: { count: orphanEventCount },
    });

    try {
      const longTransactions = await getCount(
        client,
        `
        SELECT COUNT(*)::bigint AS count
        FROM pg_stat_activity
        WHERE pid <> pg_backend_pid()
          AND xact_start IS NOT NULL
          AND state IN ('active', 'idle in transaction')
          AND now() - xact_start > ($1::text || ' seconds')::interval
        `,
        [String(transactionAgeThresholdSeconds)],
      );
      checks.push({
        name: 'long_running_transactions',
        ok: longTransactions === 0,
        details: {
          thresholdSeconds: transactionAgeThresholdSeconds,
          count: longTransactions,
        },
      });
    } catch (error) {
      checks.push({
        name: 'long_running_transactions',
        ok: !strict,
        details: {
          thresholdSeconds: transactionAgeThresholdSeconds,
          error: error instanceof Error ? error.message : 'Unknown query error',
        },
      });
    }

    const constraints = await client.query<{
      conname: string;
      convalidated: boolean;
    }>(
      `
      SELECT conname, convalidated
      FROM pg_constraint
      WHERE conname = ANY($1::text[])
      `,
      [['command_outbox_command_id_fkey', 'command_events_command_id_fkey']],
    );

    const constraintState = new Map(
      constraints.rows.map((row) => [row.conname, row.convalidated]),
    );

    const invalidConstraints = [
      'command_outbox_command_id_fkey',
      'command_events_command_id_fkey',
    ].filter((name) => constraintState.get(name) === false);

    checks.push({
      name: 'invalid_command_constraints',
      ok: invalidConstraints.length === 0,
      details: {
        invalidConstraints,
      },
    });
  } catch (error) {
    hasUnexpectedError = true;
    checks.push({
      name: 'precheck_execution',
      ok: false,
      details: {
        error: error instanceof Error ? error.message : 'Unknown error',
      },
    });
  } finally {
    await client.end();
  }

  const failedChecks = checks.filter((check) => !check.ok);
  const result = {
    status: failedChecks.length === 0 ? 'ok' : 'failed',
    strict,
    checks,
  };

  console.log(JSON.stringify(result, null, 2));

  if (hasUnexpectedError || failedChecks.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        status: 'failed',
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
});
