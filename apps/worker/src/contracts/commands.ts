export const COMMAND_CONTRACT_SCHEMA_VERSION = '1.0' as const;
export const SUPPORTED_COMMAND_CONTRACT_SCHEMA_VERSIONS = [
  COMMAND_CONTRACT_SCHEMA_VERSION,
] as const;

export type CommandContractSchemaVersion =
  (typeof SUPPORTED_COMMAND_CONTRACT_SCHEMA_VERSIONS)[number];

export type CommandRequest = {
  schemaVersion?: CommandContractSchemaVersion;
  commandId: string;
  commandType: string;
  stationId?: string;
  tenantId?: string;
  chargePointId?: string;
  connectorId?: number;
  ocppVersion?: '1.6J' | '2.0.1' | '2.1';
  requestedBy?: {
    userId?: string;
    role?: string;
    orgId?: string;
  };
  payload?: Record<string, unknown>;
  requestedAt: string;
  timeoutSec?: number;
};

export type DomainEvent = {
  schemaVersion?: CommandContractSchemaVersion;
  eventId: string;
  eventType: string;
  source: string;
  occurredAt: string;
  correlationId?: string;
  stationId?: string;
  tenantId?: string;
  chargePointId?: string;
  connectorId?: number;
  ocppVersion?: string;
  payload?: Record<string, unknown>;
};

export type ContractValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isIsoDateString = (value: unknown): value is string =>
  typeof value === 'string' && !Number.isNaN(Date.parse(value));

const readSchemaVersion = (
  value: unknown,
): ContractValidationResult<CommandContractSchemaVersion | undefined> => {
  if (value === undefined) {
    return { ok: true, value: undefined };
  }
  if (typeof value !== 'string') {
    return { ok: false, reason: 'schemaVersion must be a string' };
  }
  if (
    SUPPORTED_COMMAND_CONTRACT_SCHEMA_VERSIONS.includes(
      value as CommandContractSchemaVersion,
    )
  ) {
    return { ok: true, value: value as CommandContractSchemaVersion };
  }
  return { ok: false, reason: `Unsupported schemaVersion: ${value}` };
};

export function validateCommandRequestContract(
  input: unknown,
): ContractValidationResult<CommandRequest> {
  if (!isRecord(input)) {
    return { ok: false, reason: 'Command request must be an object' };
  }

  const schemaVersionResult = readSchemaVersion(input.schemaVersion);
  if (!schemaVersionResult.ok) {
    return schemaVersionResult;
  }

  if (
    typeof input.commandId !== 'string' ||
    input.commandId.trim().length === 0
  ) {
    return { ok: false, reason: 'commandId is required' };
  }
  if (
    typeof input.commandType !== 'string' ||
    input.commandType.trim().length === 0
  ) {
    return { ok: false, reason: 'commandType is required' };
  }
  if (!isIsoDateString(input.requestedAt)) {
    return { ok: false, reason: 'requestedAt must be an ISO date string' };
  }
  if (
    input.payload !== undefined &&
    (!isRecord(input.payload) || Array.isArray(input.payload))
  ) {
    return { ok: false, reason: 'payload must be an object when provided' };
  }
  if (
    input.requestedBy !== undefined &&
    (!isRecord(input.requestedBy) || Array.isArray(input.requestedBy))
  ) {
    return { ok: false, reason: 'requestedBy must be an object when provided' };
  }

  return {
    ok: true,
    value: input as CommandRequest,
  };
}

export function validateDomainEventContract(
  input: unknown,
): ContractValidationResult<DomainEvent> {
  if (!isRecord(input)) {
    return { ok: false, reason: 'Domain event must be an object' };
  }

  const schemaVersionResult = readSchemaVersion(input.schemaVersion);
  if (!schemaVersionResult.ok) {
    return schemaVersionResult;
  }

  if (typeof input.eventId !== 'string' || input.eventId.trim().length === 0) {
    return { ok: false, reason: 'eventId is required' };
  }
  if (
    typeof input.eventType !== 'string' ||
    input.eventType.trim().length === 0
  ) {
    return { ok: false, reason: 'eventType is required' };
  }
  if (typeof input.source !== 'string' || input.source.trim().length === 0) {
    return { ok: false, reason: 'source is required' };
  }
  if (!isIsoDateString(input.occurredAt)) {
    return { ok: false, reason: 'occurredAt must be an ISO date string' };
  }
  if (
    input.payload !== undefined &&
    (!isRecord(input.payload) || Array.isArray(input.payload))
  ) {
    return { ok: false, reason: 'payload must be an object when provided' };
  }

  return {
    ok: true,
    value: input as DomainEvent,
  };
}
