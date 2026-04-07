import { Injectable, Logger } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import * as fs from 'fs';
import { URL } from 'url';
import { TenantRoutingConfigService } from './tenant-routing-config.service';
import {
  TenantRoutingHint,
  TenantRoutingTarget,
  TenantRoutingSelection,
  TenantRoutingTier,
} from './tenant-routing.types';

type CachedClient = {
  key: string;
  selection: TenantRoutingSelection;
  organizationId: string | null;
  schema: string | null;
  client: PrismaClient;
  pool: Pool;
  lastUsedAt: number;
};

const SCHEMA_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

@Injectable()
export class TenantPrismaRoutingService {
  private readonly logger = new Logger(TenantPrismaRoutingService.name);
  private readonly sharedEntry: CachedClient;
  private readonly clients = new Map<string, CachedClient>();
  private readonly baseDatabaseUrl: string;

  constructor(private readonly config: TenantRoutingConfigService) {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      throw new Error('DATABASE_URL environment variable is not set');
    }

    this.baseDatabaseUrl = databaseUrl;
    this.sharedEntry = this.createCachedClient({
      key: 'shared',
      selection: 'shared',
      connectionString: databaseUrl,
      organizationId: null,
      schema: null,
    });
  }

  async connectShared(): Promise<void> {
    await this.sharedEntry.client.$connect();
  }

  async shutdown(): Promise<void> {
    const entries = [this.sharedEntry, ...this.clients.values()];
    this.clients.clear();

    for (const entry of entries) {
      await entry.client.$disconnect().catch(() => undefined);
      await entry.pool.end().catch(() => undefined);
    }
  }

  getSharedClient(): PrismaClient {
    this.sharedEntry.lastUsedAt = Date.now();
    return this.sharedEntry.client;
  }

  getClientForRouting(
    routing: TenantRoutingHint | null | undefined,
  ): PrismaClient {
    const target = this.resolveTarget(routing);

    if (target.selection === 'shared') {
      this.sharedEntry.lastUsedAt = Date.now();
      return this.sharedEntry.client;
    }

    let cached = this.clients.get(target.key);
    if (!cached) {
      this.evictIfNeeded();
      cached = this.createCachedClient(target);
      this.clients.set(target.key, cached);
    }

    cached.lastUsedAt = Date.now();
    return cached.client;
  }

  getRoutingMetrics(): {
    shared: {
      selection: TenantRoutingSelection;
      lastUsedAt: number;
    };
    cachedClientCount: number;
    cachedClients: Array<{
      key: string;
      selection: TenantRoutingSelection;
      organizationId: string | null;
      schema: string | null;
      lastUsedAt: number;
    }>;
  } {
    return {
      shared: {
        selection: this.sharedEntry.selection,
        lastUsedAt: this.sharedEntry.lastUsedAt,
      },
      cachedClientCount: this.clients.size,
      cachedClients: Array.from(this.clients.values()).map((entry) => ({
        key: entry.key,
        selection: entry.selection,
        organizationId: entry.organizationId,
        schema: entry.schema,
        lastUsedAt: entry.lastUsedAt,
      })),
    };
  }

  getPoolMetrics(): {
    shared: {
      totalCount: number;
      idleCount: number;
      waitingCount: number;
      max: number | null;
    };
    cached: Array<{
      key: string;
      selection: TenantRoutingSelection;
      totalCount: number;
      idleCount: number;
      waitingCount: number;
      max: number | null;
    }>;
  } {
    return {
      shared: this.readPoolMetrics(this.sharedEntry.pool),
      cached: Array.from(this.clients.values()).map((entry) => ({
        key: entry.key,
        selection: entry.selection,
        ...this.readPoolMetrics(entry.pool),
      })),
    };
  }

  private resolveTarget(
    routing: TenantRoutingHint | null | undefined,
  ): TenantRoutingTarget {
    if (!routing || !routing.organizationId || !routing.routingEnabled) {
      return {
        key: 'shared',
        selection: 'shared',
        connectionString: this.baseDatabaseUrl,
        organizationId: null,
        schema: null,
      };
    }

    const tier: TenantRoutingTier = routing.tier || 'SHARED';

    if (tier === 'SHARED') {
      return {
        key: 'shared',
        selection: 'shared',
        connectionString: this.baseDatabaseUrl,
        organizationId: null,
        schema: null,
      };
    }

    if (tier === 'SCHEMA') {
      const schema = (routing.schema || '').trim();
      if (!schema) {
        throw new Error(
          `Tenant schema is required for SCHEMA tier organization ${routing.organizationId}`,
        );
      }
      if (!SCHEMA_NAME_PATTERN.test(schema)) {
        throw new Error(
          `Invalid tenant schema name "${schema}" for organization ${routing.organizationId}`,
        );
      }

      return {
        key: `schema:${schema}`,
        selection: 'schema',
        connectionString: this.withSchema(this.baseDatabaseUrl, schema),
        organizationId: routing.organizationId,
        schema,
      };
    }

    const dedicatedDbUrl = this.config.getDedicatedDbUrlForOrganization(
      routing.organizationId,
    );
    if (!dedicatedDbUrl) {
      throw new Error(
        `Missing dedicated database URL mapping for organization ${routing.organizationId}`,
      );
    }

    return {
      key: `dedicated:${routing.organizationId}`,
      selection: 'dedicated_db',
      connectionString: dedicatedDbUrl,
      organizationId: routing.organizationId,
      schema: null,
    };
  }

  private withSchema(baseUrl: string, schema: string): string {
    const url = new URL(baseUrl);
    url.searchParams.set('schema', schema);
    return url.toString();
  }

  private evictIfNeeded(): void {
    const max = this.config.getClientCacheMax();
    if (this.clients.size < max) return;

    let oldest: CachedClient | null = null;
    for (const entry of this.clients.values()) {
      if (!oldest || entry.lastUsedAt < oldest.lastUsedAt) {
        oldest = entry;
      }
    }

    if (!oldest) return;

    this.clients.delete(oldest.key);
    void oldest.client.$disconnect().catch(() => undefined);
    void oldest.pool.end().catch(() => undefined);
    this.logger.warn(`Evicted tenant Prisma client cache entry ${oldest.key}`);
  }

  private createCachedClient(target: TenantRoutingTarget): CachedClient {
    const { pool, client } = this.createClient(target.connectionString);
    return {
      key: target.key,
      selection: target.selection,
      organizationId: target.organizationId,
      schema: target.schema,
      client,
      pool,
      lastUsedAt: Date.now(),
    };
  }

  private createClient(connectionString: string): {
    pool: Pool;
    client: PrismaClient;
  } {
    const validatedUrl =
      TenantPrismaRoutingService.validateDatabaseUrl(connectionString);
    const urlObj = new URL(validatedUrl);
    const sslmode = (urlObj.searchParams.get('sslmode') || '').toLowerCase();
    urlObj.searchParams.delete('sslmode');

    const tlsEnabled =
      (process.env.DATABASE_TLS ?? 'false') === 'true' ||
      ['require', 'verify-ca', 'verify-full'].includes(sslmode);

    const rejectUnauthorized =
      (process.env.DATABASE_TLS_REJECT_UNAUTHORIZED ?? 'true') === 'true';
    if (tlsEnabled && !rejectUnauthorized) {
      throw new Error('DATABASE_TLS_REJECT_UNAUTHORIZED=false is not allowed');
    }

    const caPath = process.env.DATABASE_TLS_CA_PATH;
    if (caPath && !fs.existsSync(caPath)) {
      throw new Error(`DATABASE_TLS_CA_PATH not found: ${caPath}`);
    }

    const pool = new Pool({
      connectionString: urlObj.toString(),
      ssl: tlsEnabled
        ? {
            rejectUnauthorized: true,
            ca: caPath ? fs.readFileSync(caPath, 'utf8') : undefined,
          }
        : undefined,
    });

    const adapter = new PrismaPg(pool);
    const client = new PrismaClient({ adapter });

    return { pool, client };
  }

  private readPoolMetrics(pool: Pool): {
    totalCount: number;
    idleCount: number;
    waitingCount: number;
    max: number | null;
  } {
    const max = typeof pool.options.max === 'number' ? pool.options.max : null;

    return {
      totalCount: pool.totalCount,
      idleCount: pool.idleCount,
      waitingCount: pool.waitingCount,
      max,
    };
  }

  private static validateDatabaseUrl(url: string): string {
    try {
      const parsedUrl = new URL(url);

      if (
        parsedUrl.protocol !== 'postgresql:' &&
        parsedUrl.protocol !== 'postgres:'
      ) {
        throw new Error(
          'Invalid database protocol. Only postgresql:// is allowed',
        );
      }

      const hostname = parsedUrl.hostname;
      if (
        hostname === 'localhost' ||
        hostname === '127.0.0.1' ||
        hostname === '::1'
      ) {
        if (process.env.NODE_ENV === 'production') {
          throw new Error(
            'Localhost database connections not allowed in production',
          );
        }
      }

      const ipv4Regex = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
      const match = hostname.match(ipv4Regex);
      if (match) {
        const [, a, b] = match.map(Number);
        if (
          a === 10 ||
          (a === 172 && b >= 16 && b <= 31) ||
          (a === 192 && b === 168)
        ) {
          if (process.env.NODE_ENV === 'production') {
            throw new Error('Private IP ranges not allowed in production');
          }
        }
      }

      return url;
    } catch (error) {
      throw new Error(
        `Invalid database URL: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }
}
