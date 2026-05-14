export type TelemetryProvider =
  | 'SMARTCAR' | 'ENODE' | 'AUTOPI' | 'OPENDBC' | 'MQTT_BMS'
  | 'OBD_DONGLE' | 'OEM_API' | 'MANUAL_IMPORT' | 'MOCK';

export type VehicleOwnershipType = 'PERSONAL' | 'ORGANIZATION' | 'FLEET';
export type VehicleStatusType = 'ACTIVE' | 'INACTIVE' | 'MAINTENANCE' | 'RETIRED';
export type PowertrainType = 'BEV' | 'PHEV' | 'HEV' | 'ICE';
export type ConnectorType = 'TYPE_1' | 'TYPE_2' | 'CCS1' | 'CCS2' | 'CHADEMO' | 'GBT_AC' | 'GBT_DC' | 'TESLA_NACS' | 'TESLA_SCS';
export type VehicleTelemetryCapability = 'READ' | 'COMMANDS';
export type VehicleTelemetryHealth = 'HEALTHY' | 'DEGRADED' | 'OFFLINE' | 'UNKNOWN';
export type VehicleFaultSeverity = 'INFO' | 'WARNING' | 'CRITICAL';
export type VehicleFaultLifecycleStatus = 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED';

export type Vehicle = {
  id: string;
  userId: string;
  ownershipType: VehicleOwnershipType | null;
  organizationId: string | null;
  fleetAccountId: string | null;
  fleetDriverId: string | null;
  fleetDriverGroupId: string | null;
  depotSiteId: string | null;
  operatingRegion: string | null;
  vehicleStatus: VehicleStatusType;
  vehicleRole: string | null;
  telemetryProvider: TelemetryProvider;
  vehicleName: string;
  make: string;
  model: string;
  yearOfManufacture: number;
  countryOfRegistration: string | null;
  powertrain: PowertrainType;
  vin: string | null;
  licensePlate: string;
  photoUrl: string | null;
  cloudinaryPublicId: string | null;
  bodyType: string | null;
  color: string | null;
  batteryKwh: number | null;
  acMaxKw: number | null;
  dcMaxKw: number | null;
  connectors: ConnectorType[];
  isActive: boolean;
  isSwappable: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type VehicleTelemetrySource = {
  id: string;
  vehicleId: string;
  provider: TelemetryProvider;
  providerVehicleId: string | null;
  capabilities: VehicleTelemetryCapability[];
  credentialRef: string | null;
  enabled: boolean;
  health: VehicleTelemetryHealth;
  lastSyncedAt: Date | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
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
  severity: VehicleFaultSeverity;
  description: string;
  timestamp: string;
};

export type VehicleCommandInput =
  | { type: 'LOCK' }
  | { type: 'UNLOCK' }
  | { type: 'START_CHARGING' }
  | { type: 'STOP_CHARGING' }
  | { type: 'SET_CHARGE_LIMIT'; limitPercent: number }
  | { type: 'START_CLIMATE' }
  | { type: 'STOP_CLIMATE' };

export type VehicleCommandStatus = 'QUEUED' | 'SENT' | 'CONFIRMED' | 'FAILED';
