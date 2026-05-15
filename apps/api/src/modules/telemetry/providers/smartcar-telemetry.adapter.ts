import { Injectable, Logger } from '@nestjs/common';
import { SmartcarProviderService } from '../smartcar-provider.service';
import {
  TelemetryProvider,
  UnifiedTelemetryData,
  VehicleCommandInput,
  VehicleTelemetryProviderAdapter,
} from '../telemetry.types';

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function boolOrNull(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

@Injectable()
export class SmartcarTelemetryAdapter implements VehicleTelemetryProviderAdapter {
  readonly provider: TelemetryProvider = 'SMARTCAR';
  private readonly logger = new Logger(SmartcarTelemetryAdapter.name);

  constructor(private readonly smartcar: SmartcarProviderService) {}

  async fetchStatus(input: {
    vehicleId: string;
    providerVehicleId?: string | null;
    lastKnown?: UnifiedTelemetryData | null;
  }): Promise<UnifiedTelemetryData> {
    const providerVehicleId = input.providerVehicleId || input.vehicleId;

    // Resolve access token via the existing token management in SmartcarProviderService
    const session = await this.smartcar.issueToken({
      credentialRef: `smartcar:${input.vehicleId}`,
    });

    const snapshot = await this.smartcar.fetchVehicleSnapshot({
      providerVehicleId,
      accessToken: session.accessToken,
    });

    const now = new Date().toISOString();

    return {
      vehicleId: input.vehicleId,
      provider: this.provider,
      providerId: providerVehicleId,
      lastSyncedAt: now,
      battery: {
        soc: snapshot.batterySoc,
        soh: null,
        temperatureC: null,
        voltageV: null,
        currentA: null,
        estimatedRangeKm: snapshot.rangeKm,
      },
      gps:
        snapshot.latitude !== null || snapshot.longitude !== null
          ? {
              latitude: snapshot.latitude,
              longitude: snapshot.longitude,
              headingDeg: null,
              speedKph: null,
              altitudeM: null,
            }
          : null,
      odometer: {
        totalKm: snapshot.odometerKm,
        tripKm: null,
      },
      faults: [],
      charging: {
        status: this.normalizeChargeState(snapshot.chargeState),
        powerKw: null,
        isPluggedIn: snapshot.isPluggedIn,
        chargeLimitPercent: snapshot.chargeLimitPercent,
      },
      sources: {
        battery: this.buildLineage('battery'),
        gps: this.buildLineage('gps'),
        odometer: this.buildLineage('odometer'),
        faults: this.buildLineage('faults'),
        charging: this.buildLineage('charging'),
        signals: {
          batterySoc: this.buildLineage('batterySoc'),
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
    const providerVehicleId = input.providerVehicleId || input.vehicleId;

    const session = await this.smartcar.issueToken({
      credentialRef: `smartcar:${input.vehicleId}`,
    });

    const result = await this.smartcar.dispatchVehicleCommand({
      providerVehicleId,
      accessToken: session.accessToken,
      command: input.command,
    });

    return { providerCommandId: result.providerCommandId };
  }

  async verifyWebhook(input: {
    rawBody: string;
    signature?: string | null;
    secretRef?: string | null;
  }): Promise<boolean> {
    if (!input.signature) return false;
    return this.smartcar.verifyWebhookSignature(input.rawBody, input.signature);
  }

  async ingestWebhook(payload: Record<string, unknown>): Promise<UnifiedTelemetryData> {
    const body = payload;
    const vehicleId = stringOrNull(body.vehicleId) || 'unknown';
    const now = new Date().toISOString();

    const batteryRec =
      body.battery && typeof body.battery === 'object'
        ? (body.battery as Record<string, unknown>)
        : {};
    const chargeRec =
      body.charge && typeof body.charge === 'object'
        ? (body.charge as Record<string, unknown>)
        : {};
    const locationRec =
      body.location && typeof body.location === 'object'
        ? (body.location as Record<string, unknown>)
        : {};
    const odometerRec =
      body.odometer && typeof body.odometer === 'object'
        ? (body.odometer as Record<string, unknown>)
        : {};

    const percentRemaining = numberOrNull(batteryRec.percentRemaining);
    const chargeLimitFraction = numberOrNull(chargeRec.limit);

    return {
      vehicleId,
      provider: this.provider,
      providerId: vehicleId,
      lastSyncedAt: now,
      battery: {
        soc: percentRemaining === null ? null : Number((percentRemaining * 100).toFixed(2)),
        soh: null,
        temperatureC: null,
        voltageV: null,
        currentA: null,
        estimatedRangeKm: numberOrNull(batteryRec.range),
      },
      gps:
        locationRec.latitude !== undefined || locationRec.longitude !== undefined
          ? {
              latitude: numberOrNull(locationRec.latitude),
              longitude: numberOrNull(locationRec.longitude),
              headingDeg: null,
              speedKph: null,
              altitudeM: null,
            }
          : null,
      odometer: {
        totalKm: numberOrNull(odometerRec.distance),
        tripKm: null,
      },
      faults: [],
      charging: {
        status: this.normalizeChargeState(stringOrNull(chargeRec.state)),
        powerKw: null,
        isPluggedIn: boolOrNull(chargeRec.isPluggedIn),
        chargeLimitPercent:
          chargeLimitFraction === null
            ? null
            : Number((chargeLimitFraction * 100).toFixed(2)),
      },
      sources: {
        battery: this.buildLineage('battery'),
        gps: this.buildLineage('gps'),
        odometer: this.buildLineage('odometer'),
        faults: this.buildLineage('faults'),
        charging: this.buildLineage('charging'),
        signals: {
          batterySoc: this.buildLineage('batterySoc'),
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

  private buildLineage(signal: string) {
    return {
      provider: this.provider as TelemetryProvider,
      providerId: null,
      lastSyncedAt: new Date().toISOString(),
      freshnessMs: 0,
      isStale: false,
    };
  }
}
