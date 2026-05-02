import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
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
