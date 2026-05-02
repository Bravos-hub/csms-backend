import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type TelemetryGateSet = {
  reads: boolean;
  commandDispatch: boolean;
  sse: boolean;
  webhooks: boolean;
};

type TelemetryGateOverrides = Partial<TelemetryGateSet>;

type TenantGateMap = Record<string, TelemetryGateOverrides>;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function readBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
  }
  return null;
}

function parseGateOverrides(value: unknown): TelemetryGateOverrides {
  const source = asRecord(value);
  const reads = readBoolean(source.reads);
  const commandDispatch = readBoolean(source.commandDispatch);
  const sse = readBoolean(source.sse);
  const webhooks = readBoolean(source.webhooks);

  return {
    ...(reads === null ? {} : { reads }),
    ...(commandDispatch === null ? {} : { commandDispatch }),
    ...(sse === null ? {} : { sse }),
    ...(webhooks === null ? {} : { webhooks }),
  };
}

function trimTenantKey(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

@Injectable()
export class TelemetryGatesService {
  private cachedTenantGatesRaw: string | null = null;
  private cachedTenantGates: TenantGateMap = {};

  constructor(
    private readonly config: ConfigService<Record<string, unknown>>,
  ) {}

  resolve(tenantId: string | null | undefined): TelemetryGateSet {
    const defaults = this.readDefaultGates();
    const tenantKey = tenantId?.trim() || null;
    if (!tenantKey) return defaults;

    const tenantGates = this.readTenantGates();
    const override = tenantGates[tenantKey];
    if (!override) return defaults;

    return {
      reads: override.reads ?? defaults.reads,
      commandDispatch: override.commandDispatch ?? defaults.commandDispatch,
      sse: override.sse ?? defaults.sse,
      webhooks: override.webhooks ?? defaults.webhooks,
    };
  }

  private readDefaultGate(key: string, fallback: boolean): boolean {
    const parsed = readBoolean(this.config.get<string>(key));
    return parsed === null ? fallback : parsed;
  }

  private readDefaultGates(): TelemetryGateSet {
    return {
      reads: this.readDefaultGate('TELEMETRY_GATES_DEFAULT_READS', true),
      commandDispatch: this.readDefaultGate(
        'TELEMETRY_GATES_DEFAULT_COMMAND_DISPATCH',
        true,
      ),
      sse: this.readDefaultGate('TELEMETRY_GATES_DEFAULT_SSE', true),
      webhooks: this.readDefaultGate('TELEMETRY_GATES_DEFAULT_WEBHOOKS', true),
    };
  }

  private readTenantGates(): TenantGateMap {
    const raw = this.config.get<string>('TELEMETRY_GATES_BY_TENANT_JSON') || '';
    if (raw === this.cachedTenantGatesRaw) {
      return this.cachedTenantGates;
    }

    this.cachedTenantGatesRaw = raw;
    this.cachedTenantGates = {};

    if (!raw.trim()) {
      return this.cachedTenantGates;
    }

    try {
      const parsed = JSON.parse(raw) as unknown;
      const root = asRecord(parsed);

      for (const [tenantKeyRaw, value] of Object.entries(root)) {
        const tenantKey = trimTenantKey(tenantKeyRaw);
        if (!tenantKey) continue;

        const gates = parseGateOverrides(value);
        if (Object.keys(gates).length === 0) continue;
        this.cachedTenantGates[tenantKey] = gates;
      }
    } catch {
      this.cachedTenantGates = {};
    }

    return this.cachedTenantGates;
  }
}
