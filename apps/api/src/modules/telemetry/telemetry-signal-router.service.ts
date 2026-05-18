import { Injectable } from '@nestjs/common';
import {
  FaultAlert,
  TelemetryProvider,
  TelemetrySourceLineage,
  UnifiedTelemetryData,
} from './telemetry.types';

type SignalKey =
  | 'batterySoc'
  | 'batterySoh'
  | 'gps'
  | 'odometer'
  | 'faults'
  | 'charging';

const PRIORITY: Record<SignalKey, TelemetryProvider[]> = {
  batterySoc: [
    'MQTT_BMS',
    'ENODE',
    'SMARTCAR',
    'AUTOPI',
    'OPENDBC',
    'OBD_DONGLE',
    'MANUAL_IMPORT',
    'MOCK',
  ],
  batterySoh: [
    'MQTT_BMS',
    'OPENDBC',
    'AUTOPI',
    'OBD_DONGLE',
    'ENODE',
    'SMARTCAR',
    'MOCK',
  ],
  gps: [
    'AUTOPI',
    'OPENDBC',
    'OBD_DONGLE',
    'SMARTCAR',
    'ENODE',
    'MQTT_BMS',
    'MOCK',
  ],
  odometer: [
    'AUTOPI',
    'OPENDBC',
    'SMARTCAR',
    'ENODE',
    'OBD_DONGLE',
    'MQTT_BMS',
    'MOCK',
  ],
  faults: [
    'OPENDBC',
    'AUTOPI',
    'OBD_DONGLE',
    'MQTT_BMS',
    'SMARTCAR',
    'ENODE',
    'MOCK',
  ],
  charging: ['ENODE', 'SMARTCAR', 'MQTT_BMS', 'AUTOPI', 'OPENDBC', 'MOCK'],
};

@Injectable()
export class TelemetrySignalRouterService {
  merge(statuses: UnifiedTelemetryData[]): UnifiedTelemetryData {
    if (statuses.length === 0) {
      throw new Error('Cannot merge empty statuses array');
    }

    const base = statuses[0];
    const result: UnifiedTelemetryData = {
      ...base,
      battery: { ...base.battery },
      gps: base.gps ? { ...base.gps } : null,
      odometer: { ...base.odometer },
      faults: [...base.faults],
      charging: { ...base.charging },
      sources: {
        battery: base.sources.battery,
        gps: base.sources.gps,
        odometer: base.sources.odometer,
        faults: base.sources.faults,
        charging: base.sources.charging,
        signals: { ...base.sources.signals },
      },
    };

    const pick = (
      key: SignalKey,
      getter: (s: UnifiedTelemetryData) => unknown,
    ): void => {
      const candidates = PRIORITY[key]
        .map((provider) => {
          const status = statuses.find((s) => s.provider === provider);
          if (!status) return null;
          const lineage = this.getLineageForSignal(status, key);
          if (!lineage || lineage.isStale) return null;
          const value = getter(status);
          if (value === null || value === undefined) return null;
          return { provider, value, lineage };
        })
        .filter((c): c is NonNullable<typeof c> => Boolean(c));

      if (candidates.length > 0) {
        const winner = candidates[0];
        this.setSignal(result, key, winner.value);
        this.setLineage(result, key, winner.lineage);
      }
    };

    pick('batterySoc', (s) => s.battery.soc);
    pick('batterySoh', (s) => s.battery.soh);
    pick('gps', (s) => s.gps);
    pick('odometer', (s) => s.odometer.totalKm);
    pick('faults', (s) => s.faults);
    pick('charging', (s) => s.charging.status);

    // Merge all faults from all non-stale sources
    const allFaults = statuses
      .flatMap((s) => s.faults.map((f) => ({ ...f, _provider: s.provider })))
      .filter((f) => {
        const lineage = this.getLineageForSignal(
          statuses.find((s) => s.provider === f._provider)!,
          'faults',
        );
        return !lineage?.isStale;
      });
    result.faults = this.dedupeFaults(allFaults);

    // Use the most recent lastSyncedAt
    const latestSync = statuses
      .map((s) => s.lastSyncedAt)
      .filter((d): d is string => Boolean(d))
      .sort()
      .pop();
    result.lastSyncedAt = latestSync || result.lastSyncedAt;

    return result;
  }

  private getLineageForSignal(
    status: UnifiedTelemetryData,
    signal: SignalKey,
  ): TelemetrySourceLineage | null {
    switch (signal) {
      case 'batterySoc':
      case 'batterySoh':
        return status.sources.signals.batterySoc || status.sources.battery;
      case 'gps':
        return status.sources.gps;
      case 'odometer':
        return status.sources.odometer;
      case 'faults':
        return status.sources.faults;
      case 'charging':
        return status.sources.charging;
      default:
        return null;
    }
  }

  private setSignal(
    result: UnifiedTelemetryData,
    key: SignalKey,
    value: unknown,
  ): void {
    switch (key) {
      case 'batterySoc':
        result.battery.soc = value as number | null;
        break;
      case 'batterySoh':
        result.battery.soh = value as number | null;
        break;
      case 'gps':
        result.gps = value as UnifiedTelemetryData['gps'];
        break;
      case 'odometer':
        // Keep the winner's odometer object if available
        break;
      case 'faults':
        break;
      case 'charging':
        result.charging.status =
          value as UnifiedTelemetryData['charging']['status'];
        break;
    }
  }

  private setLineage(
    result: UnifiedTelemetryData,
    key: SignalKey,
    lineage: TelemetrySourceLineage,
  ): void {
    switch (key) {
      case 'batterySoc':
        result.sources.signals.batterySoc = lineage;
        result.sources.battery = lineage;
        break;
      case 'batterySoh':
        result.sources.signals.batterySoh = lineage;
        break;
      case 'gps':
        result.sources.gps = lineage;
        break;
      case 'odometer':
        result.sources.odometer = lineage;
        break;
      case 'faults':
        result.sources.faults = lineage;
        break;
      case 'charging':
        result.sources.charging = lineage;
        break;
    }
  }

  private dedupeFaults(faults: FaultAlert[]): FaultAlert[] {
    const seen = new Set<string>();
    return faults.filter((f) => {
      const key = `${f.vehicleId}_${f.code}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
}
