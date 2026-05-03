import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Max,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

const COMMAND_TYPES = [
  'LOCK',
  'UNLOCK',
  'START_CHARGING',
  'STOP_CHARGING',
  'SET_CHARGE_LIMIT',
  'START_CLIMATE',
  'STOP_CLIMATE',
] as const;

const PROVIDERS = [
  'SMARTCAR',
  'ENODE',
  'AUTOPI',
  'OPENDBC',
  'MQTT_BMS',
  'OBD_DONGLE',
  'OEM_API',
  'MANUAL_IMPORT',
  'MOCK',
] as const;

const TELEMETRY_CAPABILITIES = ['READ', 'COMMANDS'] as const;

export class VehicleCommandPayloadDto {
  @IsString()
  @IsIn(COMMAND_TYPES)
  type:
    | 'LOCK'
    | 'UNLOCK'
    | 'START_CHARGING'
    | 'STOP_CHARGING'
    | 'SET_CHARGE_LIMIT'
    | 'START_CLIMATE'
    | 'STOP_CLIMATE';

  @ValidateIf(
    (payload: VehicleCommandPayloadDto) =>
      payload.type === 'SET_CHARGE_LIMIT' || payload.limitPercent !== undefined,
  )
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limitPercent?: number;
}

export class SendVehicleCommandDto {
  @ValidateNested()
  @Type(() => VehicleCommandPayloadDto)
  command: VehicleCommandPayloadDto;

  @IsOptional()
  @IsString()
  @IsIn(PROVIDERS)
  provider?: (typeof PROVIDERS)[number];

  @IsOptional()
  @IsString()
  providerId?: string;
}

export class TelemetryStatusQueryDto {
  @IsOptional()
  @IsString()
  @IsIn(PROVIDERS)
  provider?: (typeof PROVIDERS)[number];

  @IsOptional()
  @IsString()
  providerId?: string;
}

export class ProviderWebhookPayloadDto {
  @IsOptional()
  @IsString()
  vehicleId?: string;

  @IsOptional()
  @IsString()
  providerVehicleId?: string;

  @IsOptional()
  @IsObject()
  battery?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  gps?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  odometer?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  charging?: Record<string, unknown>;

  @IsOptional()
  faults?: unknown;

  @IsOptional()
  @IsObject()
  sources?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  lastSyncedAt?: string;

  @IsOptional()
  @IsObject()
  rawPayload?: Record<string, unknown>;
}

export class CreateVehicleTelemetrySourceDto {
  @IsOptional()
  @IsString()
  @IsIn(PROVIDERS)
  provider?: (typeof PROVIDERS)[number];

  @IsOptional()
  @IsString()
  @MaxLength(180)
  providerId?: string | null;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(240)
  credentialRef?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(2)
  @IsIn(TELEMETRY_CAPABILITIES, { each: true })
  capabilities?: Array<(typeof TELEMETRY_CAPABILITIES)[number]>;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class UpdateVehicleTelemetrySourceDto {
  @IsOptional()
  @IsString()
  @MaxLength(180)
  providerId?: string | null;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(240)
  credentialRef?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(2)
  @IsIn(TELEMETRY_CAPABILITIES, { each: true })
  capabilities?: Array<(typeof TELEMETRY_CAPABILITIES)[number]>;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class SmartcarIssueTokenDto {
  @IsString()
  @IsNotEmpty()
  vehicleId: string;

  @IsOptional()
  @IsString()
  @MaxLength(180)
  providerId?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(240)
  credentialRef: string;
}

export class SmartcarRefreshTokenDto {
  @IsString()
  @IsNotEmpty()
  vehicleId: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(240)
  credentialRef: string;

  @IsString()
  @IsNotEmpty()
  refreshToken: string;
}

export class SmartcarVehicleCommandDto {
  @ValidateNested()
  @Type(() => VehicleCommandPayloadDto)
  command: VehicleCommandPayloadDto;

  @IsOptional()
  @IsString()
  @MaxLength(180)
  providerId?: string;
}

export class TelemetryStorageRawQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;
}
