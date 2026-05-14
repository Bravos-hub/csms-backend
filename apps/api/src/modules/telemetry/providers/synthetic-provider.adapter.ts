import {
  TelemetryProvider,
  UnifiedTelemetryData,
  VehicleTelemetryProviderAdapter,
} from '../telemetry.types';

const TELEMETRY_STALE_MS = 60_000;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function nowIso(): string {
  return new Date().toISOString();
}

function buildLineage(
  provider: TelemetryProvider,
  providerId: string | null,
  lastSyncedAt: string | null,
): {
  provider: TelemetryProvider;
  providerId: string | null;
  lastSyncedAt: string | null;
  freshnessMs: number | null;
  isStale: boolean;
} {
  const freshnessMs = lastSyncedAt ? Date.now() - Date.parse(lastSyncedAt) : null;
  return {
    provider,
    providerId,
    lastSyncedAt,
    freshnessMs,
    isStale: freshnessMs === null ? true : freshnessMs > TELEMETRY_STALE_MS,
  };
}

export class SyntheticTelemetryAdapter implements VehicleTelemetryProviderAdapter {
  constructor(readonly provider: TelemetryProvider) {}

  async fetchStatus(input: {
    vehicleId: string;
    providerVehicleId?: string | null;
    lastKnown?: UnifiedTelemetryData | null;
  }): Promise<UnifiedTelemetryData> {
    const wave = Math.sin(Date.now() / 90_000);
    const socBase: Record<TelemetryProvider, number> = {
      SMARTCAR: 64,
      ENODE: 61,
      AUTOPI: 58,
      OPENDBC: 57,
      MQTT_BMS: 55,
      OBD_DONGLE: 56,
      OEM_API: 63,
      MANUAL_IMPORT: 59,
      MOCK: 62,
    };

    const providerId = input.providerVehicleId || `${this.provider.toLowerCase()}:${input.vehicleId}`;
    const lastSyncedAt = nowIso();
    const lineage = buildLineage(this.provider, providerId, lastSyncedAt);
    const gpsEnabled =
      this.provider === 'AUTOPI' ||
      this.provider === 'OPENDBC' ||
      this.provider === 'ENODE' ||
      this.provider === 'OEM_API';

    return {
      vehicleId: input.vehicleId,
      provider: this.provider,
      providerId,
      lastSyncedAt,
      battery: {
        soh: numberOrNull(input.lastKnown?.battery.soh) ?? Number((91 + wave).toFixed(2)),
        soc: Number((Math.max(3, Math.min(100, socBase[this.provider] + wave * 2))).toFixed(2)),
        temperatureC: Number((31 + wave).toFixed(2)),
        voltageV: Number((392 + wave * 4).toFixed(2)),
        currentA: Number((16 + wave * 3).toFixed(2)),
        estimatedRangeKm: Number((210 + wave * 15).toFixed(1)),
      },
      gps: gpsEnabled
        ? {
            latitude: Number((0.3476 + wave * 0.0002).toFixed(6)),
            longitude: Number((32.5825 + wave * 0.0002).toFixed(6)),
            headingDeg: Number((90 + wave * 12).toFixed(1)),
            speedKph: Number((40 + wave * 8).toFixed(1)),
            altitudeM: 1189,
          }
        : null,
      odometer: {
        totalKm: Number((12500 + wave * 2).toFixed(1)),
        tripKm: Number((12 + wave * 2).toFixed(1)),
      },
      faults: input.lastKnown?.faults || [],
      charging: {
        status: input.lastKnown?.charging.status || 'IDLE',
        powerKw: input.lastKnown?.charging.powerKw ?? 0,
        isPluggedIn: input.lastKnown?.charging.isPluggedIn ?? false,
        chargeLimitPercent: input.lastKnown?.charging.chargeLimitPercent ?? 85,
      },
      sources: {
        battery: lineage,
        gps: gpsEnabled ? lineage : null,
        odometer: lineage,
        faults: lineage,
        charging: lineage,
        signals: {
          batterySoc: lineage,
          batterySoh: lineage,
          hvCurrent: lineage,
          hvVoltage: lineage,
          gpsSpeed: gpsEnabled ? lineage : null,
          gpsHeading: gpsEnabled ? lineage : null,
        },
      },
    };
  }
}
