import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsISO8601,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

const ROAMING_PROTOCOLS = ['OCPI', 'OCHP', 'OICP', 'EMIP'] as const;
const V2X_MODES = ['V2G', 'V2X'] as const;
const TERMINAL_RECONCILIATION_STATUSES = [
  'PENDING',
  'AUTHORIZED',
  'SETTLED',
  'FAILED',
  'CANCELED',
  'EXPIRED',
] as const;

export class OpenAdrSettingsDto {
  @Type(() => Boolean)
  @IsBoolean()
  enabled: boolean;

  @IsOptional()
  @IsString()
  venId?: string;

  @IsOptional()
  @IsString()
  programName?: string;

  @IsOptional()
  @IsString()
  marketContext?: string;

  @IsOptional()
  @IsString()
  responseMode?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(5)
  @Max(1_440)
  defaultDurationMinutes?: number;

  @IsOptional()
  @IsString()
  signalName?: string;

  @IsOptional()
  @IsString()
  signalType?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  priority?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  targetStationIds?: string[];
}

export class OpenAdrEventDto {
  @IsString()
  @IsNotEmpty()
  stationId: string;

  @IsOptional()
  @IsString()
  eventId?: string;

  @IsISO8601()
  startsAt: string;

  @IsISO8601()
  endsAt: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  signalValueKw: number;

  @IsOptional()
  @IsString()
  signalName?: string;

  @IsOptional()
  @IsString()
  signalType?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  priority?: number;

  @IsOptional()
  @IsString()
  reason?: string;
}

export class RoamingPartnerProtocolsDto {
  @IsArray()
  @IsIn(ROAMING_PROTOCOLS, { each: true })
  protocols: (typeof ROAMING_PROTOCOLS)[number][];

  @IsOptional()
  @IsString()
  transport?: string;

  @IsOptional()
  @IsObject()
  endpointOverrides?: Record<string, unknown>;
}

export class V2xProfileUpsertDto {
  @Type(() => Boolean)
  @IsBoolean()
  enabled: boolean;

  @IsIn(V2X_MODES)
  mode: (typeof V2X_MODES)[number];

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  maxDischargeKw?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  minSocPercent?: number;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  bidirectionalDispatch?: boolean;

  @IsOptional()
  @IsString()
  provider?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class AutochargeEnrollmentDto {
  @IsString()
  @IsNotEmpty()
  driverId: string;

  @IsString()
  @IsNotEmpty()
  tokenUid: string;

  @IsOptional()
  @IsString()
  vehicleId?: string;

  @IsOptional()
  @IsString()
  vehicleVin?: string;

  @IsOptional()
  @IsString()
  chargePointId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10)
  connectorId?: number;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class SmartQueueQueryDto {
  @IsOptional()
  @IsString()
  stationId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class TerminalRegistrationDto {
  @IsString()
  @IsNotEmpty()
  terminalId: string;

  @IsOptional()
  @IsString()
  locationName?: string;

  @IsOptional()
  @IsString()
  model?: string;

  @IsOptional()
  @IsString()
  provider?: string;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  cardReaderIds?: string[];

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class TerminalCheckoutIntentDto {
  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  amount: number;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsString()
  @IsNotEmpty()
  terminalId: string;

  @IsOptional()
  @IsString()
  cardReaderId?: string;

  @IsString()
  @IsNotEmpty()
  idempotencyKey: string;

  @IsOptional()
  @IsString()
  correlationId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(120)
  ttlMinutes?: number;

  @IsOptional()
  @IsString()
  callbackUrl?: string;

  @IsOptional()
  @IsString()
  sessionId?: string;

  @IsOptional()
  @IsString()
  invoiceId?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class TerminalIntentReconcileDto {
  @IsIn(TERMINAL_RECONCILIATION_STATUSES)
  status: (typeof TERMINAL_RECONCILIATION_STATUSES)[number];

  @IsOptional()
  @IsString()
  providerReference?: string;

  @IsOptional()
  @IsString()
  note?: string;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  markSettled?: boolean;
}

export class LoyaltyTransactionDto {
  @IsString()
  @IsNotEmpty()
  driverId: string;

  @Type(() => Number)
  @IsInt()
  points: number;

  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsString()
  correlationId?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class AutochargeListQueryDto {
  @IsOptional()
  @IsString()
  driverId?: string;
}

export class DriverWorkflowQueryDto {
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  includeHistory?: boolean;
}
