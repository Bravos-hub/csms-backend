import { Injectable } from '@nestjs/common';

const DEFAULT_CLIENT_CACHE_MAX = 200;

function parseCsv(value?: string): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  return fallback;
}

function parseDedicatedDbMap(value?: string): Record<string, string> {
  if (!value || value.trim().length === 0) {
    return {};
  }

  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }

    const parsedRecord = parsed as Record<string, unknown>;
    const output: Record<string, string> = {};
    for (const [key, rawUrl] of Object.entries(parsedRecord)) {
      if (typeof rawUrl !== 'string') continue;
      const normalizedKey = key.trim();
      const normalizedUrl = rawUrl.trim();
      if (!normalizedKey || !normalizedUrl) continue;
      output[normalizedKey] = normalizedUrl;
    }

    return output;
  } catch {
    return {};
  }
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

@Injectable()
export class TenantRoutingConfigService {
  private readonly platformHosts = parseCsv(process.env.TENANT_PLATFORM_HOSTS);
  private readonly dedicatedDbMap = parseDedicatedDbMap(
    process.env.TENANT_DEDICATED_DB_URLS_JSON,
  );
  private readonly headerFallbackDev = parseBoolean(
    process.env.TENANT_HEADER_FALLBACK_DEV,
    true,
  );
  private readonly clientCacheMax = parsePositiveInt(
    process.env.TENANT_CLIENT_CACHE_MAX,
    DEFAULT_CLIENT_CACHE_MAX,
  );

  getPlatformHosts(): string[] {
    return [...this.platformHosts];
  }

  getDedicatedDbUrlForOrganization(organizationId: string): string | null {
    return this.dedicatedDbMap[organizationId] || null;
  }

  isHeaderFallbackEnabledForLocalhost(isLocalhost: boolean): boolean {
    return isLocalhost && this.headerFallbackDev;
  }

  getClientCacheMax(): number {
    return this.clientCacheMax;
  }
}
