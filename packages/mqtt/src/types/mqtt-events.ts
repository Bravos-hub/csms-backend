export interface MqttEventBase {
  tenantId: string;
  siteId: string;
  timestamp: Date;
  messageId?: string;
}

export interface BatteryCabinetStatusEvent extends MqttEventBase {
  stationId: string;
  cabinetId: string;
  isOnline: boolean;
  powerState: 'OK' | 'LOW' | 'CRITICAL';
  doorLocked: boolean;
  robotHealth: 'OK' | 'WARNING' | 'FAULT';
  totalSlots: number;
  occupiedSlots: number;
  faultCodes: string[];
}

export interface BatteryPackStateEvent extends MqttEventBase {
  packSerialNumber: string;
  slotId: string;
  soc: number;
  health: number;
  voltage: number;
  current: number;
  cycles: number;
  temperature: number;
  status: 'AVAILABLE' | 'IN_TRANSIT' | 'SWAPPING' | 'DEGRADED';
}

export interface BatterySwapSessionEvent extends MqttEventBase {
  stationId: string;
  swapSessionId: string;
  vehicleId?: string;
  inboundPackSerialNumber: string;
  outboundPackSerialNumber: string;
  stage:
    | 'INITIATED'
    | 'DOCKING'
    | 'DISCONNECTING_OLD'
    | 'RECONNECTING_NEW'
    | 'UNDOCKING'
    | 'COMPLETE';
  duration?: number;
  error?: string;
}

export interface ChargerStatusEvent extends MqttEventBase {
  chargerId: string;
  connectorStatus: 'AVAILABLE' | 'OCCUPIED' | 'UNAVAILABLE' | 'FAULTED';
  connectorPower: number;
  voltage: number;
  current: number;
}

export interface ChargerTransactionEvent extends MqttEventBase {
  chargerId: string;
  transactionId: string;
  userId?: string;
  rfidTag?: string;
  startTime: Date;
  endTime?: Date;
  energyDelivered: number;
  status: 'STARTED' | 'COMPLETED' | 'STOPPED' | 'ERROR';
}

export interface MeterReadingEvent extends MqttEventBase {
  meterId: string;
  energyExported: number;
  energyImported: number;
  voltage: number;
  current: number;
  power: number;
  frequency: number;
}

export interface PvOutputEvent extends MqttEventBase {
  pvSystemId: string;
  powerOutput: number;
  irradiance?: number;
}

export interface SmartChargingCommandEvent extends MqttEventBase {
  chargerId: string;
  commandType:
    | 'SET_POWER_LIMIT'
    | 'REMOTE_START'
    | 'REMOTE_STOP'
    | 'SET_AVAILABILITY';
  payload: Record<string, unknown>;
}

export interface LegacyEvseStatusEvent extends MqttEventBase {
  chargerId: string;
  connectorStatus: 'AVAILABLE' | 'OCCUPIED' | 'UNAVAILABLE' | 'FAULTED';
  connectorPower: number;
  voltage: number;
  current: number;
  vendorStatus: string;
}

export interface LegacyEvseTransactionEvent extends MqttEventBase {
  chargerId: string;
  transactionId: string;
  userId?: string;
  rfidTag?: string;
  startTime: Date;
  endTime?: Date;
  energyDelivered: number;
  status: 'STARTED' | 'COMPLETED' | 'STOPPED' | 'ERROR';
}

export type MqttEvent =
  | BatteryCabinetStatusEvent
  | BatteryPackStateEvent
  | BatterySwapSessionEvent
  | ChargerStatusEvent
  | ChargerTransactionEvent
  | MeterReadingEvent
  | PvOutputEvent
  | SmartChargingCommandEvent
  | LegacyEvseStatusEvent
  | LegacyEvseTransactionEvent;
