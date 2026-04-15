export interface AdapterDeviceInfo {
  vendorDeviceId: string;
  vendorProviderId: string;
  internalStationId: string;
  internalSiteId: string;
  tenantId: string;
  capabilities: {
    canRemoteControl: boolean;
    canReceiveCommands: boolean;
    supportsMetering: boolean;
    supportsSmartCharging: boolean;
  };
}

export interface AdapterPayloadValidationResult {
  valid: boolean;
  errors: string[];
  normalizedData?: Record<string, unknown>;
}

export interface AdapterCommandResult {
  success: boolean;
  commandId: string;
  error?: string;
  timestamp: Date;
}

export abstract class BaseMqttAdapter {
  abstract adapterName: string;

  abstract validateAndNormalizePayload(
    topic: string,
    payload: Buffer,
  ): Promise<AdapterPayloadValidationResult>;

  abstract lookupDeviceRegistry(
    vendorDeviceId: string,
  ): Promise<AdapterDeviceInfo>;

  abstract sendCommand(
    deviceInfo: AdapterDeviceInfo,
    command: Record<string, unknown>,
  ): Promise<AdapterCommandResult>;

  abstract validateEventSequence(
    deviceId: string,
    eventType: string,
  ): Promise<{ valid: boolean; reason?: string }>;

  abstract deduplicateEvent(
    deviceId: string,
    messageId: string,
    timestamp: Date,
  ): Promise<boolean>;
}
