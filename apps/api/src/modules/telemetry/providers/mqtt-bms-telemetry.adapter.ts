import { Injectable, Logger } from '@nestjs/common';
import {
  FaultAlert,
  TelemetryProvider,
  UnifiedTelemetryData,
  VehicleTelemetryProviderAdapter,
} from '../telemetry.types';

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

@Injectable()
export class MqttBmsTelemetryAdapter implements VehicleTelemetryProviderAdapter {
  readonly provider: TelemetryProvider = 'MQTT_BMS';
  private readonly logger = new Logger(MqttBmsTelemetryAdapter.name);

  async fetchStatus(input: {
    vehicleId: string;
    providerVehicleId?: string | null;
    lastKnown?: UnifiedTelemetryData | null;
  }): Promise<UnifiedTelemetryData> {
    const now = new Date().toISOString();
    const providerId = input.providerVehicleId || input.vehicleId;

    // Placeholder: real implementation would read from BatteryPack / BatteryTelemetry
    // or from MQTT BMS device registry mapped to the vehicle.
    this.logger.warn(`MQTT_BMS fetchStatus not yet fully implemented for vehicle ${input.vehicleId}`);

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

  async ingestWebhook(payload: Record<string, unknown>): Promise<UnifiedTelemetryData> {
    const now = new Date().toISOString();
    const vehicleId = stringOrNull(payload.vehicleId) || 'unknown';

    const batteryRec =
      payload.battery && typeof payload.battery === 'object'
        ? (payload.battery as Record<string, unknown>)
        : {};

    const faults: FaultAlert[] = [];
    const soc = numberOrNull(batteryRec.soc);
    if (soc !== null && soc <= 10) {
      faults.push({
        id: `bms_${vehicleId}_low_soc`,
        vehicleId,
        code: 'BMS_LOW_SOC',
        severity: 'WARNING',
        description: `Battery SOC is critically low (${soc}%)`,
        timestamp: now,
      });
    }

    return {
      vehicleId,
      provider: this.provider,
      providerId: vehicleId,
      lastSyncedAt: now,
      battery: {
        soc,
        soh: numberOrNull(batteryRec.soh),
        temperatureC: numberOrNull(batteryRec.temperature),
        voltageV: numberOrNull(batteryRec.voltage),
        currentA: numberOrNull(batteryRec.current),
        estimatedRangeKm: numberOrNull(batteryRec.estimatedRangeKm),
      },
      gps: null,
      odometer: { totalKm: null, tripKm: null },
      faults,
      charging: {
        status: null,
        powerKw: null,
        isPluggedIn: null,
        chargeLimitPercent: null,
      },
      sources: {
        battery: this.buildLineage(vehicleId),
        gps: null,
        odometer: null,
        faults: faults.length > 0 ? this.buildLineage(vehicleId) : null,
        charging: null,
        signals: {
          batterySoc: this.buildLineage(vehicleId),
          batterySoh: this.buildLineage(vehicleId),
          hvCurrent: this.buildLineage(vehicleId),
          hvVoltage: this.buildLineage(vehicleId),
          gpsSpeed: null,
          gpsHeading: null,
        },
      },
    };
  }

  private buildLineage(providerId: string | null) {
    return {
      provider: this.provider as TelemetryProvider,
      providerId,
      lastSyncedAt: new Date().toISOString(),
      freshnessMs: 0,
      isStale: false,
    };
  }
}
