import 'dotenv/config';
import { Client } from 'pg';

type CheckResult = {
  name: string;
  ok: boolean;
  details: Record<string, unknown>;
};

type ProfileSnapshot = {
  vehiclesTotal: number;
  vehiclesMissingOwnershipType: number;
  vehiclesOrgOrFleetMissingOrganization: number;
  vehiclesPersonalWithOrganization: number;
  vehiclesCanBackfillOrgFromUser: number;
  vehiclesCanBackfillOrgFromSingleActiveMembership: number;
  vehiclesOrgMissingOrgWithAmbiguousMembership: number;
  vehiclesOrgOrFleetMissingOrgWithoutCandidate: number;
  commandsTotal: number;
  commandsMissingDomain: number;
  commandsNonCanonicalDomain: number;
  commandsUnsupportedDomain: number;
  unresolvedVehicleSamples: string[];
  unsupportedDomainSamples: string[];
};

type ApplySummary = {
  ownershipTypeBackfilled: number;
  organizationFromUserBackfilled: number;
  organizationFromMembershipBackfilled: number;
  commandDomainDefaultBackfilled: number;
  commandDomainCanonicalized: number;
};

const TARGET_MIGRATION = '20260502190000_vehicle_fleet_telemetry_foundation';

function getArgValue(flag: string): string | undefined {
  for (let index = process.argv.length - 2; index >= 0; index -= 1) {
    if (process.argv[index] === flag) {
      return process.argv[index + 1];
    }
  }
  return undefined;
}

function parseBoolArg(flag: string, fallback: boolean): boolean {
  const raw = getArgValue(flag);
  if (!raw) return fallback;
  const normalized = raw.trim().toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  return fallback;
}

function parseIntArg(flag: string, fallback: number): number {
  const raw = getArgValue(flag);
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return parsed;
}

async function getCount(
  client: Client,
  query: string,
  values: unknown[] = [],
): Promise<number> {
  const result = await client.query<{ count: string }>(query, values);
  return Number.parseInt(result.rows[0]?.count ?? '0', 10);
}

async function tableExists(client: Client, tableName: string): Promise<boolean> {
  const result = await client.query<{ exists: boolean }>(
    `SELECT to_regclass($1) IS NOT NULL AS exists`,
    [`public.${tableName}`],
  );
  return result.rows[0]?.exists === true;
}

async function checkColumnCoverage(client: Client): Promise<CheckResult> {
  const requiredColumns: Record<string, string[]> = {
    vehicles: [
      'ownership_type',
      'organization_id',
      'fleet_account_id',
      'fleet_driver_id',
      'fleet_driver_group_id',
      'depot_site_id',
      'operating_region',
      'vehicle_status',
      'vehicle_role',
      'telemetry_provider',
    ],
    commands: [
      'domain',
      'vehicle_id',
      'provider',
      'provider_vehicle_id',
      'provider_command_id',
      'result_code',
    ],
    webhooks: ['organization_id', 'timeout_ms', 'max_retries'],
  };

  const tableNames = Object.keys(requiredColumns);
  const rows = await client.query<{ table_name: string; column_name: string }>(
    `
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = ANY($1::text[])
    `,
    [tableNames],
  );

  const byTable = new Map<string, Set<string>>();
  for (const row of rows.rows) {
    if (!byTable.has(row.table_name)) {
      byTable.set(row.table_name, new Set<string>());
    }
    byTable.get(row.table_name)!.add(row.column_name);
  }

  const missing: Record<string, string[]> = {};
  for (const [tableName, columns] of Object.entries(requiredColumns)) {
    const actual = byTable.get(tableName) || new Set<string>();
    const missingColumns = columns.filter((column) => !actual.has(column));
    if (missingColumns.length > 0) {
      missing[tableName] = missingColumns;
    }
  }

  return {
    name: 'schema_columns_present',
    ok: Object.keys(missing).length === 0,
    details: {
      requiredTables: tableNames,
      missing,
    },
  };
}

async function checkRequiredTables(client: Client): Promise<CheckResult> {
  const requiredTables = [
    'vehicle_telemetry_sources',
    'vehicle_telemetry_snapshots',
    'vehicle_telemetry_latest',
    'vehicle_faults',
    'webhook_deliveries',
  ];

  const missing: string[] = [];
  for (const tableName of requiredTables) {
    if (!(await tableExists(client, tableName))) {
      missing.push(tableName);
    }
  }

  return {
    name: 'schema_tables_present',
    ok: missing.length === 0,
    details: {
      missing,
      requiredTables,
    },
  };
}

async function checkMigrationRecord(client: Client): Promise<CheckResult> {
  const migrationsTable = await tableExists(client, '_prisma_migrations');
  if (!migrationsTable) {
    return {
      name: 'prisma_migration_record',
      ok: false,
      details: {
        reason: '_prisma_migrations table not found',
        migration: TARGET_MIGRATION,
      },
    };
  }

  const count = await getCount(
    client,
    `
      SELECT COUNT(*)::bigint AS count
      FROM "_prisma_migrations"
      WHERE migration_name = $1
        AND finished_at IS NOT NULL
        AND rolled_back_at IS NULL
    `,
    [TARGET_MIGRATION],
  );

  return {
    name: 'prisma_migration_record',
    ok: count > 0,
    details: {
      migration: TARGET_MIGRATION,
      matchedRows: count,
    },
  };
}

async function buildProfile(
  client: Client,
  sampleLimit: number,
): Promise<ProfileSnapshot> {
  const vehiclesTotal = await getCount(client, `SELECT COUNT(*)::bigint AS count FROM "vehicles"`);
  const vehiclesMissingOwnershipType = await getCount(
    client,
    `SELECT COUNT(*)::bigint AS count FROM "vehicles" WHERE "ownership_type" IS NULL`,
  );
  const vehiclesOrgOrFleetMissingOrganization = await getCount(
    client,
    `
      SELECT COUNT(*)::bigint AS count
      FROM "vehicles"
      WHERE "organization_id" IS NULL
        AND "ownership_type" IN ('ORGANIZATION'::"VehicleOwnershipType", 'FLEET'::"VehicleOwnershipType")
    `,
  );
  const vehiclesPersonalWithOrganization = await getCount(
    client,
    `
      SELECT COUNT(*)::bigint AS count
      FROM "vehicles"
      WHERE "organization_id" IS NOT NULL
        AND "ownership_type" = 'PERSONAL'::"VehicleOwnershipType"
    `,
  );
  const vehiclesCanBackfillOrgFromUser = await getCount(
    client,
    `
      SELECT COUNT(*)::bigint AS count
      FROM "vehicles" v
      INNER JOIN "users" u ON u."id" = v."userId"
      WHERE v."organization_id" IS NULL
        AND v."ownership_type" IN ('ORGANIZATION'::"VehicleOwnershipType", 'FLEET'::"VehicleOwnershipType")
        AND u."organizationId" IS NOT NULL
    `,
  );
  const vehiclesCanBackfillOrgFromSingleActiveMembership = await getCount(
    client,
    `
      WITH one_active_membership AS (
        SELECT tm."userId", MIN(tm."organizationId") AS "organizationId"
        FROM "tenant_memberships" tm
        WHERE tm."status" = 'ACTIVE'
        GROUP BY tm."userId"
        HAVING COUNT(*) = 1
      )
      SELECT COUNT(*)::bigint AS count
      FROM "vehicles" v
      INNER JOIN one_active_membership m ON m."userId" = v."userId"
      WHERE v."organization_id" IS NULL
        AND v."ownership_type" IN ('ORGANIZATION'::"VehicleOwnershipType", 'FLEET'::"VehicleOwnershipType")
    `,
  );
  const vehiclesOrgMissingOrgWithAmbiguousMembership = await getCount(
    client,
    `
      WITH many_active_memberships AS (
        SELECT tm."userId"
        FROM "tenant_memberships" tm
        WHERE tm."status" = 'ACTIVE'
        GROUP BY tm."userId"
        HAVING COUNT(*) > 1
      )
      SELECT COUNT(*)::bigint AS count
      FROM "vehicles" v
      INNER JOIN many_active_memberships m ON m."userId" = v."userId"
      WHERE v."organization_id" IS NULL
        AND v."ownership_type" IN ('ORGANIZATION'::"VehicleOwnershipType", 'FLEET'::"VehicleOwnershipType")
    `,
  );
  const vehiclesOrgOrFleetMissingOrgWithoutCandidate = await getCount(
    client,
    `
      WITH one_active_membership AS (
        SELECT tm."userId", MIN(tm."organizationId") AS "organizationId"
        FROM "tenant_memberships" tm
        WHERE tm."status" = 'ACTIVE'
        GROUP BY tm."userId"
        HAVING COUNT(*) = 1
      )
      SELECT COUNT(*)::bigint AS count
      FROM "vehicles" v
      LEFT JOIN "users" u ON u."id" = v."userId"
      LEFT JOIN one_active_membership m ON m."userId" = v."userId"
      WHERE v."organization_id" IS NULL
        AND v."ownership_type" IN ('ORGANIZATION'::"VehicleOwnershipType", 'FLEET'::"VehicleOwnershipType")
        AND u."organizationId" IS NULL
        AND m."organizationId" IS NULL
    `,
  );

  const commandsTotal = await getCount(client, `SELECT COUNT(*)::bigint AS count FROM "commands"`);
  const commandsMissingDomain = await getCount(
    client,
    `
      SELECT COUNT(*)::bigint AS count
      FROM "commands"
      WHERE "domain" IS NULL OR btrim("domain") = ''
    `,
  );
  const commandsNonCanonicalDomain = await getCount(
    client,
    `
      SELECT COUNT(*)::bigint AS count
      FROM "commands"
      WHERE "domain" IS NOT NULL
        AND btrim("domain") <> ''
        AND "domain" <> upper(btrim("domain"))
        AND upper(btrim("domain")) IN ('CHARGE_POINT', 'VEHICLE')
    `,
  );
  const commandsUnsupportedDomain = await getCount(
    client,
    `
      SELECT COUNT(*)::bigint AS count
      FROM "commands"
      WHERE "domain" IS NOT NULL
        AND btrim("domain") <> ''
        AND upper(btrim("domain")) NOT IN ('CHARGE_POINT', 'VEHICLE')
    `,
  );

  const unresolvedVehicleSamplesResult = await client.query<{ id: string }>(
    `
      WITH one_active_membership AS (
        SELECT tm."userId", MIN(tm."organizationId") AS "organizationId"
        FROM "tenant_memberships" tm
        WHERE tm."status" = 'ACTIVE'
        GROUP BY tm."userId"
        HAVING COUNT(*) = 1
      )
      SELECT v."id"
      FROM "vehicles" v
      LEFT JOIN "users" u ON u."id" = v."userId"
      LEFT JOIN one_active_membership m ON m."userId" = v."userId"
      WHERE v."organization_id" IS NULL
        AND v."ownership_type" IN ('ORGANIZATION'::"VehicleOwnershipType", 'FLEET'::"VehicleOwnershipType")
        AND u."organizationId" IS NULL
        AND m."organizationId" IS NULL
      ORDER BY v."createdAt" DESC
      LIMIT $1
    `,
    [sampleLimit],
  );

  const unsupportedDomainSamplesResult = await client.query<{ domain: string }>(
    `
      SELECT DISTINCT "domain"
      FROM "commands"
      WHERE "domain" IS NOT NULL
        AND btrim("domain") <> ''
        AND upper(btrim("domain")) NOT IN ('CHARGE_POINT', 'VEHICLE')
      ORDER BY "domain" ASC
      LIMIT $1
    `,
    [sampleLimit],
  );

  return {
    vehiclesTotal,
    vehiclesMissingOwnershipType,
    vehiclesOrgOrFleetMissingOrganization,
    vehiclesPersonalWithOrganization,
    vehiclesCanBackfillOrgFromUser,
    vehiclesCanBackfillOrgFromSingleActiveMembership,
    vehiclesOrgMissingOrgWithAmbiguousMembership,
    vehiclesOrgOrFleetMissingOrgWithoutCandidate,
    commandsTotal,
    commandsMissingDomain,
    commandsNonCanonicalDomain,
    commandsUnsupportedDomain,
    unresolvedVehicleSamples: unresolvedVehicleSamplesResult.rows.map((row) => row.id),
    unsupportedDomainSamples: unsupportedDomainSamplesResult.rows.map((row) => row.domain),
  };
}

async function applyBackfill(client: Client): Promise<ApplySummary> {
  await client.query('BEGIN');
  try {
    const organizationFromUserBackfilled = (
      await client.query(
        `
          UPDATE "vehicles" v
          SET "organization_id" = u."organizationId"
          FROM "users" u
          WHERE v."userId" = u."id"
            AND v."organization_id" IS NULL
            AND u."organizationId" IS NOT NULL
            AND (v."ownership_type" IS NULL OR v."ownership_type" IN ('ORGANIZATION'::"VehicleOwnershipType", 'FLEET'::"VehicleOwnershipType"))
        `,
      )
    ).rowCount;

    const organizationFromMembershipBackfilled = (
      await client.query(
        `
          WITH one_active_membership AS (
            SELECT tm."userId", MIN(tm."organizationId") AS "organizationId"
            FROM "tenant_memberships" tm
            WHERE tm."status" = 'ACTIVE'
            GROUP BY tm."userId"
            HAVING COUNT(*) = 1
          )
          UPDATE "vehicles" v
          SET "organization_id" = m."organizationId"
          FROM one_active_membership m
          WHERE v."userId" = m."userId"
            AND v."organization_id" IS NULL
            AND (v."ownership_type" IS NULL OR v."ownership_type" IN ('ORGANIZATION'::"VehicleOwnershipType", 'FLEET'::"VehicleOwnershipType"))
        `,
      )
    ).rowCount;

    const ownershipTypeBackfilled = (
      await client.query(
        `
          UPDATE "vehicles" v
          SET "ownership_type" = CASE
            WHEN v."organization_id" IS NOT NULL AND v."fleet_account_id" IS NOT NULL THEN 'FLEET'::"VehicleOwnershipType"
            WHEN v."organization_id" IS NOT NULL THEN 'ORGANIZATION'::"VehicleOwnershipType"
            ELSE 'PERSONAL'::"VehicleOwnershipType"
          END
          WHERE v."ownership_type" IS NULL
        `,
      )
    ).rowCount;

    const commandDomainDefaultBackfilled = (
      await client.query(
        `
          UPDATE "commands"
          SET "domain" = 'CHARGE_POINT'
          WHERE "domain" IS NULL OR btrim("domain") = ''
        `,
      )
    ).rowCount;

    const commandDomainCanonicalized = (
      await client.query(
        `
          UPDATE "commands"
          SET "domain" = upper(btrim("domain"))
          WHERE "domain" IS NOT NULL
            AND btrim("domain") <> ''
            AND "domain" <> upper(btrim("domain"))
            AND upper(btrim("domain")) IN ('CHARGE_POINT', 'VEHICLE')
        `,
      )
    ).rowCount;

    await client.query('COMMIT');
    return {
      ownershipTypeBackfilled,
      organizationFromUserBackfilled,
      organizationFromMembershipBackfilled,
      commandDomainDefaultBackfilled,
      commandDomainCanonicalized,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function main() {
  const strict = parseBoolArg('--strict', true);
  const apply = parseBoolArg('--apply', false);
  const sampleLimit = parseIntArg('--sample-limit', 20);
  const insecureSsl =
    parseBoolArg('--insecure-ssl', false) ||
    parseBoolArg('--allow-insecure-ssl', false) ||
    process.env.PGSSL_ALLOW_SELF_SIGNED === 'true';

  if (insecureSsl) {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required.');
  }

  const client = new Client({
    connectionString: databaseUrl,
    ...(insecureSsl
      ? {
          ssl: {
            rejectUnauthorized: false,
          },
        }
      : {}),
  });
  await client.connect();

  const checks: CheckResult[] = [];
  let hasUnexpectedError = false;
  let beforeProfile: ProfileSnapshot | null = null;
  let afterProfile: ProfileSnapshot | null = null;
  let applySummary: ApplySummary | null = null;

  try {
    const migrationCheck = await checkMigrationRecord(client);
    const requiredTablesCheck = await checkRequiredTables(client);
    const columnCoverageCheck = await checkColumnCoverage(client);
    checks.push(migrationCheck, requiredTablesCheck, columnCoverageCheck);

    const schemaReady = requiredTablesCheck.ok && columnCoverageCheck.ok;
    if (!schemaReady) {
      checks.push({
        name: 'data_profile_skipped',
        ok: true,
        details: {
          reason: 'Schema tables/columns are not ready yet. Run prisma migrate deploy first.',
        },
      });
    } else {
      beforeProfile = await buildProfile(client, sampleLimit);

      checks.push({
        name: 'vehicles_ownership_type_backfilled',
        ok: beforeProfile.vehiclesMissingOwnershipType === 0,
        details: {
          count: beforeProfile.vehiclesMissingOwnershipType,
        },
      });

      checks.push({
        name: 'vehicles_org_or_fleet_have_organization',
        ok: beforeProfile.vehiclesOrgOrFleetMissingOrganization === 0,
        details: {
          count: beforeProfile.vehiclesOrgOrFleetMissingOrganization,
          unresolvedWithoutCandidate:
            beforeProfile.vehiclesOrgOrFleetMissingOrgWithoutCandidate,
          unresolvedVehicleSamples: beforeProfile.unresolvedVehicleSamples,
        },
      });

      checks.push({
        name: 'commands_domain_default_backfilled',
        ok: beforeProfile.commandsMissingDomain === 0,
        details: {
          count: beforeProfile.commandsMissingDomain,
        },
      });

      checks.push({
        name: 'commands_domain_supported',
        ok: beforeProfile.commandsUnsupportedDomain === 0,
        details: {
          count: beforeProfile.commandsUnsupportedDomain,
          samples: beforeProfile.unsupportedDomainSamples,
        },
      });

      if (apply) {
        applySummary = await applyBackfill(client);
        afterProfile = await buildProfile(client, sampleLimit);
      }
    }
  } catch (error) {
    hasUnexpectedError = true;
    checks.push({
      name: 'execution',
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
    apply,
    insecureSsl,
    checks,
    profile: {
      before: beforeProfile,
      after: afterProfile,
    },
    applySummary,
    recommendedCommands: [
      'pnpm run ops:vehicles:fleet-telemetry:verify',
      'pnpm run ops:vehicles:fleet-telemetry:apply',
      'pnpm run ops:vehicles:fleet-telemetry:verify -- --strict true',
    ],
  };

  console.log(JSON.stringify(result, null, 2));

  if (hasUnexpectedError || (strict && failedChecks.length > 0)) {
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

