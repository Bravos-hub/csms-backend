export type TelemetryProvider =
  | 'SMARTCAR'
  | 'ENODE'
  | 'AUTOPI'
  | 'OPENDBC'
  | 'MQTT_BMS'
  | 'OBD_DONGLE'
  | 'OEM_API'
  | 'MANUAL_IMPORT'
  | 'MOCK';

export type VehicleCommandInput =
  | { type: 'LOCK' }
  | { type: 'UNLOCK' }
  | { type: 'START_CHARGING' }
  | { type: 'STOP_CHARGING' }
  | { type: 'SET_CHARGE_LIMIT'; limitPercent: number }
  | { type: 'START_CLIMATE' }
  | { type: 'STOP_CLIMATE' };

export type VehicleCommandStatus = 'QUEUED' | 'SENT' | 'CONFIRMED' | 'FAILED';

export type TelemetryFeatureGates = {
  reads: boolean;
  commandDispatch: boolean;
  sse: boolean;
  webhooks: boolean;
};

export type TelemetrySourceLineage = {
  provider: TelemetryProvider;
  providerId: string | null;
  lastSyncedAt: string | null;
  freshnessMs: number | null;
  isStale: boolean;
};

export type FaultAlert = {
  id: string;
  vehicleId: string;
  code: string;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  description: string;
  timestamp: string;
};

export type UnifiedTelemetryData = {
  vehicleId: string;
  provider: TelemetryProvider;
  providerId: string | null;
  lastSyncedAt: string | null;
  battery: {
    soh: number | null;
    soc: number | null;
    temperatureC: number | null;
    voltageV: number | null;
    currentA: number | null;
    estimatedRangeKm: number | null;
  };
  gps: {
    latitude: number | null;
    longitude: number | null;
    headingDeg: number | null;
    speedKph: number | null;
    altitudeM: number | null;
  } | null;
  odometer: {
    totalKm: number | null;
    tripKm: number | null;
  };
  faults: FaultAlert[];
  charging: {
    status: 'IDLE' | 'CHARGING' | 'COMPLETED' | 'FAULTED' | null;
    powerKw: number | null;
    isPluggedIn: boolean | null;
    chargeLimitPercent: number | null;
  };
  sources: {
    battery: TelemetrySourceLineage | null;
    gps: TelemetrySourceLineage | null;
    odometer: TelemetrySourceLineage | null;
    faults: TelemetrySourceLineage | null;
    charging: TelemetrySourceLineage | null;
    signals: {
      batterySoc: TelemetrySourceLineage | null;
      batterySoh: TelemetrySourceLineage | null;
      hvCurrent: TelemetrySourceLineage | null;
      hvVoltage: TelemetrySourceLineage | null;
      gpsSpeed: TelemetrySourceLineage | null;
      gpsHeading: TelemetrySourceLineage | null;
    };
  };
};

export type VehicleCommandResult = {
  accepted: boolean;
  provider: TelemetryProvider;
  providerCommandId: string | null;
  commandId: string;
  status: VehicleCommandStatus;
  errorCode: string | null;
};

export type VehicleTelemetrySourceRecord = {
  id: string;
  vehicleId: string;
  provider: TelemetryProvider;
  providerId: string | null;
  credentialRef: string | null;
  enabled: boolean;
  capabilities: Array<'READ' | 'COMMANDS'>;
  health: 'HEALTHY' | 'DEGRADED' | 'OFFLINE' | 'UNKNOWN';
  lastSyncedAt: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
};

export type TelemetryWebhookIngestResult = {
  accepted: boolean;
  provider: TelemetryProvider;
  lagMs: number | null;
  isStale: boolean;
};

export type VehicleTelemetryProviderAdapter = {
  provider: TelemetryProvider;
  fetchStatus: (input: {
    vehicleId: string;
    providerVehicleId?: string | null;
    lastKnown?: UnifiedTelemetryData | null;
  }) => Promise<UnifiedTelemetryData>;
  sendCommand?: (input: {
    vehicleId: string;
    providerVehicleId?: string | null;
    command: VehicleCommandInput;
  }) => Promise<{ providerCommandId: string | null }>;
};
