import { Injectable, Logger } from '@nestjs/common';
import {
  TelemetryProvider,
  UnifiedTelemetryData,
  VehicleCommandInput,
  VehicleTelemetryProviderAdapter,
} from '../telemetry.types';

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function boolOrNull(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

@Injectable()
export class EnodeTelemetryAdapter implements VehicleTelemetryProviderAdapter {
  readonly provider: TelemetryProvider = 'ENODE';
  private readonly logger = new Logger(EnodeTelemetryAdapter.name);

  async fetchStatus(input: {
    vehicleId: string;
    providerVehicleId?: string | null;
    lastKnown?: UnifiedTelemetryData | null;
  }): Promise<UnifiedTelemetryData> {
    const now = new Date().toISOString();
    const providerId = input.providerVehicleId || input.vehicleId;

    // Placeholder: Enode API integration would go here.
    // For now, return a structured placeholder so the registry can register the adapter.
    this.logger.warn(`Enode fetchStatus not yet implemented for vehicle ${input.vehicleId}`);

    return {
      vehicleId: input.vehicleId,
      provider: this.provider,
      providerId,
      lastSyncedAt: now,
      battery: {
        soc: null,
        soh: null,
        temperatureC: null,
        voltageV: null,
        currentA: null,
        estimatedRangeKm: null,
      },
      gps: null,
      odometer: { totalKm: null, tripKm: null },
      faults: [],
      charging: {
        status: null,
        powerKw: null,
        isPluggedIn: null,
        chargeLimitPercent: null,
      },
      sources: {
        battery: null,
        gps: null,
        odometer: null,
        faults: null,
        charging: null,
        signals: {
          batterySoc: null,
          batterySoh: null,
          hvCurrent: null,
          hvVoltage: null,
          gpsSpeed: null,
          gpsHeading: null,
        },
      },
    };
  }

  async sendCommand(input: {
    vehicleId: string;
    providerVehicleId?: string | null;
    command: VehicleCommandInput;
  }): Promise<{ providerCommandId: string | null }> {
    this.logger.warn(`Enode sendCommand not yet implemented for vehicle ${input.vehicleId}`);
    throw new Error('Enode command dispatch not yet implemented');
  }

  async verifyWebhook(input: {
    rawBody: string;
    signature?: string | null;
    secretRef?: string | null;
  }): Promise<boolean> {
    // Placeholder: implement HMAC verification with Enode webhook secret
    return false;
  }

  async ingestWebhook(payload: Record<string, unknown>): Promise<UnifiedTelemetryData> {
    const now = new Date().toISOString();
    const vehicleId = stringOrNull(payload.vehicleId) || 'unknown';

    const chargeRec =
      payload.charge && typeof payload.charge === 'object'
        ? (payload.charge as Record<string, unknown>)
        : {};
    const batteryRec =
      payload.battery && typeof payload.battery === 'object'
        ? (payload.battery as Record<string, unknown>)
        : {};

    return {
      vehicleId,
      provider: this.provider,
      providerId: vehicleId,
      lastSyncedAt: now,
      battery: {
        soc: numberOrNull(batteryRec.stateOfCharge),
        soh: null,
        temperatureC: null,
        voltageV: null,
        currentA: null,
        estimatedRangeKm: numberOrNull(batteryRec.range),
      },
      gps: null,
      odometer: { totalKm: null, tripKm: null },
      faults: [],
      charging: {
        status: this.normalizeChargeState(stringOrNull(chargeRec.state)),
        powerKw: numberOrNull(chargeRec.power),
        isPluggedIn: boolOrNull(chargeRec.isPluggedIn),
        chargeLimitPercent: null,
      },
      sources: {
        battery: this.buildLineage(),
        gps: null,
        odometer: null,
        faults: null,
        charging: this.buildLineage(),
        signals: {
          batterySoc: this.buildLineage(),
          batterySoh: null,
          hvCurrent: null,
          hvVoltage: null,
          gpsSpeed: null,
          gpsHeading: null,
        },
      },
    };
  }

  private normalizeChargeState(
    state: string | null,
  ): 'IDLE' | 'CHARGING' | 'COMPLETED' | 'FAULTED' | null {
    if (!state) return null;
    const s = state.toUpperCase();
    if (s === 'CHARGING') return 'CHARGING';
    if (s === 'FULLY_CHARGED' || s === 'COMPLETED') return 'COMPLETED';
    if (s === 'NOT_CHARGING' || s === 'IDLE') return 'IDLE';
    if (s === 'FAULTED') return 'FAULTED';
    return 'IDLE';
  }

  private buildLineage() {
    return {
      provider: this.provider as TelemetryProvider,
      providerId: null,
      lastSyncedAt: new Date().toISOString(),
      freshnessMs: 0,
      isStale: false,
    };
  }
}
