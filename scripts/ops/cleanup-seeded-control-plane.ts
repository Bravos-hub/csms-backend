import 'dotenv/config';
import { Client } from 'pg';

type CountRow = {
  count: string;
};

type ExistsRow = {
  exists: boolean;
};

type SuperAdminRow = {
  id: string;
  name: string;
  email: string | null;
  role: string;
};

type TablePlan = {
  tableName: string;
  rows: number;
};

type CleanupPlan = {
  apply: boolean;
  database: string;
  host: string;
  preservedSuperAdmins: SuperAdminRow[];
  deleteAllTables: TablePlan[];
  filteredDeletes: TablePlan[];
  totals: {
    rowsFromDeleteAllTables: number;
    rowsFromFilteredDeletes: number;
  };
};

const DELETE_ALL_TABLES = [
  'telemetry_ingest_alerts',
  'vehicle_faults',
  'vehicle_telemetry_latest',
  'vehicle_telemetry_snapshots',
  'vehicle_telemetry_sources',
  'battery_telemetry',
  'battery_packs',
  'firmware_update_events',
  'ChargePointStatusHistory',
  'command_events',
  'command_outbox',
  'commands',
  'ocpi_partner_cdrs',
  'ocpi_partner_sessions',
  'ocpi_partner_tokens',
  'ocpi_partner_tariffs',
  'ocpi_partner_locations',
  'ocpi_partners',
  'mqtt_vendor_payload_logs',
  'mqtt_subscription_states',
  'mqtt_device_registry',
  'webhook_deliveries',
  'webhooks',
  'developer_api_usage',
  'developer_api_keys',
  'developer_apps',
  'enterprise_identity_sync_jobs',
  'enterprise_identity_providers',
  'pnc_certificate_events',
  'pnc_contract_certificates',
  'pnc_contracts',
  'energy_load_group_memberships',
  'energy_load_groups',
  'energy_telemetry_snapshots',
  'energy_allocation_decisions',
  'energy_alerts',
  'energy_manual_overrides',
  'tariff_calendars',
  'energy_optimization_plans',
  'energy_management_schedules',
  'energy_plan_runs',
  'energy_der_profiles',
  'charging_receipt_transactions',
  'booking_events',
  'bookings',
  'sessions',
  'transactions',
  'wallets',
  'invoices',
  'payment_webhook_events',
  'payment_intents',
  'payment_methods',
  'attendant_notifications',
  'attendant_sync_actions',
  'attendant_assignment_requests',
  'attendant_assignments',
  'station_team_assignments',
  'staff_payout_profiles',
  'dispatches',
  'incidents',
  'jobs',
  'technician_availability',
  'documents',
  'negotiation_rounds',
  'provider_settlement_entries',
  'provider_documents',
  'provider_relationships',
  'swap_providers',
  'fleet_driver_tokens',
  'fleet_drivers',
  'fleet_driver_groups',
  'fleet_accounts',
  'site_documents',
  'site_lease_details',
  'tenants',
  'charge_points',
  'stations',
  'tenant_applications',
  'approval_requests',
  'marketplace_contact_events',
  'vehicles',
  'sites',
  'user_applications',
  'user_invitations',
  'organization_memberships',
  'tenant_custom_role_permissions',
  'tenant_custom_roles',
  'tenant_memberships',
  'tenant_branding_revisions',
  'organizations',
] as const;

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

function parseOptionalIntArg(flag: string): number | null {
  const raw = getArgValue(flag);
  if (!raw) return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function quoteIdentifier(identifier: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) {
    throw new Error(`Unsafe SQL identifier: ${identifier}`);
  }
  return `"${identifier.replace(/"/g, '""')}"`;
}

function resolveDatabaseUrl(): string {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required.');
  }
  return databaseUrl;
}

function describeDatabase(databaseUrl: string): {
  database: string;
  host: string;
} {
  const parsed = new URL(databaseUrl);
  return {
    database: parsed.pathname.replace(/^\//, ''),
    host: parsed.host,
  };
}

async function tableExists(
  client: Client,
  tableName: string,
): Promise<boolean> {
  const result = await client.query<ExistsRow>(
    'SELECT to_regclass($1) IS NOT NULL AS exists',
    [`public.${tableName}`],
  );
  return result.rows[0]?.exists === true;
}

async function countRows(
  client: Client,
  tableName: string,
  whereSql = '',
  values: unknown[] = [],
): Promise<number> {
  if (!(await tableExists(client, tableName))) {
    return 0;
  }

  const result = await client.query<CountRow>(
    `SELECT COUNT(*)::text AS count FROM ${quoteIdentifier(tableName)} ${whereSql}`,
    values,
  );
  return Number.parseInt(result.rows[0]?.count ?? '0', 10);
}

async function deleteRows(
  client: Client,
  tableName: string,
  whereSql = '',
  values: unknown[] = [],
): Promise<number> {
  if (!(await tableExists(client, tableName))) {
    return 0;
  }

  const result = await client.query(
    `DELETE FROM ${quoteIdentifier(tableName)} ${whereSql}`,
    values,
  );
  return result.rowCount ?? 0;
}

async function resolvePreservedSuperAdmins(
  client: Client,
): Promise<SuperAdminRow[]> {
  const result = await client.query<SuperAdminRow>(
    `
      SELECT DISTINCT u.id, u.name, u.email, u.role
      FROM users u
      LEFT JOIN platform_role_assignments pra
        ON pra."userId" = u.id
       AND pra."roleKey" = 'PLATFORM_SUPER_ADMIN'
       AND pra.status = 'ACTIVE'
      WHERE u.role = 'SUPER_ADMIN' OR pra.id IS NOT NULL
      ORDER BY u.email NULLS LAST, u.name
    `,
  );
  return result.rows;
}

async function buildPlan(
  client: Client,
  input: {
    apply: boolean;
    databaseUrl: string;
    preservedSuperAdmins: SuperAdminRow[];
  },
): Promise<CleanupPlan> {
  const preservedIds = input.preservedSuperAdmins.map((user) => user.id);
  const deleteAllTables: TablePlan[] = [];
  for (const tableName of DELETE_ALL_TABLES) {
    deleteAllTables.push({
      tableName,
      rows: await countRows(client, tableName),
    });
  }

  const filteredDeletes: TablePlan[] = [
    {
      tableName: 'refresh_tokens',
      rows: await countRows(
        client,
        'refresh_tokens',
        'WHERE "userId" <> ALL($1::text[])',
        [preservedIds],
      ),
    },
    {
      tableName: 'platform_role_assignments',
      rows: await countRows(
        client,
        'platform_role_assignments',
        'WHERE "userId" <> ALL($1::text[])',
        [preservedIds],
      ),
    },
    {
      tableName: 'users',
      rows: await countRows(client, 'users', 'WHERE id <> ALL($1::text[])', [
        preservedIds,
      ]),
    },
  ];

  const database = describeDatabase(input.databaseUrl);
  return {
    apply: input.apply,
    ...database,
    preservedSuperAdmins: input.preservedSuperAdmins,
    deleteAllTables,
    filteredDeletes,
    totals: {
      rowsFromDeleteAllTables: deleteAllTables.reduce(
        (sum, entry) => sum + entry.rows,
        0,
      ),
      rowsFromFilteredDeletes: filteredDeletes.reduce(
        (sum, entry) => sum + entry.rows,
        0,
      ),
    },
  };
}

async function applyCleanup(
  client: Client,
  preservedSuperAdmins: SuperAdminRow[],
): Promise<void> {
  const preservedIds = preservedSuperAdmins.map((user) => user.id);
  await client.query('BEGIN');
  try {
    for (const tableName of DELETE_ALL_TABLES) {
      await deleteRows(client, tableName);
    }

    await deleteRows(
      client,
      'refresh_tokens',
      'WHERE "userId" <> ALL($1::text[])',
      [preservedIds],
    );
    await deleteRows(
      client,
      'platform_role_assignments',
      'WHERE "userId" <> ALL($1::text[])',
      [preservedIds],
    );
    await deleteRows(client, 'users', 'WHERE id <> ALL($1::text[])', [
      preservedIds,
    ]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function verifyCleanup(
  client: Client,
  preservedSuperAdmins: SuperAdminRow[],
): Promise<Record<string, number>> {
  const preservedIds = preservedSuperAdmins.map((user) => user.id);
  return {
    users: await countRows(client, 'users'),
    nonSuperAdminUsers: await countRows(
      client,
      'users',
      'WHERE id <> ALL($1::text[])',
      [preservedIds],
    ),
    organizations: await countRows(client, 'organizations'),
    sites: await countRows(client, 'sites'),
    stations: await countRows(client, 'stations'),
    chargePoints: await countRows(client, 'charge_points'),
    vehicles: await countRows(client, 'vehicles'),
  };
}

async function main(): Promise<void> {
  const apply = parseBoolArg('--apply', false);
  const insecureSsl =
    parseBoolArg('--insecure-ssl', false) ||
    parseBoolArg('--allow-insecure-ssl', false) ||
    process.env.PGSSL_ALLOW_SELF_SIGNED === 'true';
  const expectedSuperAdmins = parseOptionalIntArg('--expect-super-admins');
  const databaseUrl = resolveDatabaseUrl();

  if (insecureSsl) {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
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

  try {
    const preservedSuperAdmins = await resolvePreservedSuperAdmins(client);
    if (preservedSuperAdmins.length === 0) {
      throw new Error('Refusing cleanup because no super admins were found.');
    }
    if (
      expectedSuperAdmins !== null &&
      preservedSuperAdmins.length !== expectedSuperAdmins
    ) {
      throw new Error(
        `Expected ${expectedSuperAdmins} preserved super admins, found ${preservedSuperAdmins.length}.`,
      );
    }

    const before = await buildPlan(client, {
      apply,
      databaseUrl,
      preservedSuperAdmins,
    });
    console.log(JSON.stringify({ status: 'planned', before }, null, 2));

    if (!apply) {
      console.log(
        JSON.stringify(
          {
            status: 'dry_run_only',
            nextCommand:
              'tsx ./scripts/ops/cleanup-seeded-control-plane.ts --apply true',
          },
          null,
          2,
        ),
      );
      return;
    }

    await applyCleanup(client, preservedSuperAdmins);
    const after = await verifyCleanup(client, preservedSuperAdmins);
    console.log(JSON.stringify({ status: 'applied', after }, null, 2));
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(JSON.stringify({ status: 'error', reason: message }, null, 2));
  process.exit(1);
});
