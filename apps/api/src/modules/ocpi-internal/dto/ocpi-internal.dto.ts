import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class OcpiPartnerLocationUpsertDto {
  @IsString()
  @IsNotEmpty()
  countryCode: string;

  @IsString()
  @IsNotEmpty()
  partyId: string;

  @IsString()
  @IsNotEmpty()
  locationId: string;

  @IsOptional()
  @IsString()
  version?: string;

  @IsObject()
  data: Record<string, unknown>;

  @IsOptional()
  @IsISO8601()
  lastUpdated?: string;

  @IsOptional()
  @IsString()
  @IsIn(['LOCATION', 'EVSE', 'CONNECTOR'])
  objectType?: 'LOCATION' | 'EVSE' | 'CONNECTOR';

  @IsOptional()
  @IsString()
  evseUid?: string;

  @IsOptional()
  @IsString()
  connectorId?: string;
}

export class OcpiPartnerTariffUpsertDto {
  @IsString()
  @IsNotEmpty()
  countryCode: string;

  @IsString()
  @IsNotEmpty()
  partyId: string;

  @IsString()
  @IsNotEmpty()
  tariffId: string;

  @IsOptional()
  @IsString()
  version?: string;

  @IsObject()
  data: Record<string, unknown>;

  @IsOptional()
  @IsISO8601()
  lastUpdated?: string;
}

export class OcpiPartnerTariffDeleteDto {
  @IsString()
  @IsNotEmpty()
  countryCode: string;

  @IsString()
  @IsNotEmpty()
  partyId: string;

  @IsString()
  @IsNotEmpty()
  tariffId: string;

  @IsOptional()
  @IsString()
  version?: string;

  @IsOptional()
  @IsISO8601()
  deletedAt?: string;
}

export class OcpiTokenUpsertDto {
  @IsString()
  @IsNotEmpty()
  countryCode: string;

  @IsString()
  @IsNotEmpty()
  partyId: string;

  @IsString()
  @IsNotEmpty()
  tokenUid: string;

  @IsOptional()
  @IsString()
  tokenType?: string;

  @IsObject()
  data: Record<string, unknown>;

  @IsOptional()
  @IsISO8601()
  lastUpdated?: string;

  @IsOptional()
  @IsBoolean()
  valid?: boolean;
}

export class OcpiTokenAuthorizeDto {
  @IsString()
  @IsNotEmpty()
  tokenUid: string;

  @IsOptional()
  @IsString()
  tokenType?: string;

  @IsOptional()
  @IsString()
  countryCode?: string;

  @IsOptional()
  @IsString()
  partyId?: string;

  @IsOptional()
  @IsObject()
  location?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  authorizationReference?: string;
}

export class OcpiPartnerTokenUpsertDto {
  @IsString()
  @IsNotEmpty()
  countryCode: string;

  @IsString()
  @IsNotEmpty()
  partyId: string;

  @IsString()
  @IsNotEmpty()
  tokenUid: string;

  @IsOptional()
  @IsString()
  tokenType?: string;

  @IsOptional()
  @IsString()
  version?: string;

  @IsObject()
  data: Record<string, unknown>;

  @IsOptional()
  @IsISO8601()
  lastUpdated?: string;
}

export class OcpiPartnerTokenQueryDto {
  @IsOptional()
  @IsString()
  countryCode?: string;

  @IsOptional()
  @IsString()
  partyId?: string;

  @IsOptional()
  @IsString()
  tokenUid?: string;

  @IsOptional()
  @IsString()
  tokenType?: string;

  @IsOptional()
  @IsString()
  version?: string;
}

export class OcpiPartnerSessionUpsertDto {
  @IsString()
  @IsNotEmpty()
  countryCode: string;

  @IsString()
  @IsNotEmpty()
  partyId: string;

  @IsString()
  @IsNotEmpty()
  sessionId: string;

  @IsOptional()
  @IsString()
  version?: string;

  @IsObject()
  data: Record<string, unknown>;

  @IsOptional()
  @IsISO8601()
  lastUpdated?: string;
}

export class OcpiPartnerSessionQueryDto {
  @IsOptional()
  @IsString()
  countryCode?: string;

  @IsOptional()
  @IsString()
  partyId?: string;

  @IsOptional()
  @IsString()
  sessionId?: string;

  @IsOptional()
  @IsString()
  version?: string;
}

export class OcpiSessionChargingPreferencesDto {
  @IsOptional()
  @IsString()
  version?: string;

  @IsObject()
  data: Record<string, unknown>;

  @IsOptional()
  @IsISO8601()
  updatedAt?: string;
}

export class OcpiPartnerCdrUpsertDto {
  @IsString()
  @IsNotEmpty()
  countryCode: string;

  @IsString()
  @IsNotEmpty()
  partyId: string;

  @IsString()
  @IsNotEmpty()
  cdrId: string;

  @IsOptional()
  @IsString()
  version?: string;

  @IsObject()
  data: Record<string, unknown>;

  @IsOptional()
  @IsISO8601()
  lastUpdated?: string;
}

export class OcpiPartnerCdrQueryDto {
  @IsOptional()
  @IsString()
  countryCode?: string;

  @IsOptional()
  @IsString()
  partyId?: string;

  @IsOptional()
  @IsString()
  cdrId?: string;

  @IsOptional()
  @IsString()
  version?: string;
}

export class OcpiInternalCommandRequestDto {
  @IsString()
  @IsNotEmpty()
  version: string;

  @IsString()
  @IsNotEmpty()
  role: string;

  @IsString()
  @IsNotEmpty()
  @IsIn([
    'START_SESSION',
    'STOP_SESSION',
    'UNLOCK_CONNECTOR',
    'RESERVE_NOW',
    'CANCEL_RESERVATION',
  ])
  command: string;

  @IsObject()
  request: Record<string, unknown>;

  @IsString()
  @IsNotEmpty()
  requestId: string;

  @IsOptional()
  @IsString()
  correlationId?: string;

  @IsOptional()
  @IsString()
  partnerId?: string;

  @IsOptional()
  @IsISO8601()
  requestedAt?: string;
}

export class OcpiInternalCommandResultDto {
  @IsString()
  @IsNotEmpty()
  version: string;

  @IsString()
  @IsNotEmpty()
  role: string;

  @IsString()
  @IsNotEmpty()
  command: string;

  @IsString()
  @IsNotEmpty()
  requestId: string;

  @IsObject()
  result: Record<string, unknown>;

  @IsOptional()
  @IsString()
  correlationId?: string;

  @IsOptional()
  @IsString()
  partnerId?: string;

  @IsOptional()
  @IsISO8601()
  occurredAt?: string;
}

export class OcpiPartnerCreateDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  partyId: string;

  @IsString()
  @IsNotEmpty()
  countryCode: string;

  @IsString()
  @IsNotEmpty()
  role: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  version?: string;

  @IsOptional()
  @IsString()
  versionsUrl?: string;

  @IsOptional()
  @IsString()
  tokenA?: string;

  @IsOptional()
  @IsString()
  tokenB?: string;

  @IsOptional()
  @IsString()
  tokenC?: string;

  @IsOptional()
  @IsArray()
  roles?: Record<string, unknown>[];

  @IsOptional()
  @IsArray()
  endpoints?: Record<string, unknown>[];

  @IsOptional()
  @IsISO8601()
  lastSyncAt?: string;
}

export class OcpiPartnerUpdateDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  partyId?: string;

  @IsOptional()
  @IsString()
  countryCode?: string;

  @IsOptional()
  @IsString()
  role?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  version?: string;

  @IsOptional()
  @IsString()
  versionsUrl?: string;

  @IsOptional()
  @IsString()
  tokenA?: string;

  @IsOptional()
  @IsString()
  tokenB?: string;

  @IsOptional()
  @IsString()
  tokenC?: string;

  @IsOptional()
  @IsArray()
  roles?: Record<string, unknown>[];

  @IsOptional()
  @IsArray()
  endpoints?: Record<string, unknown>[];

  @IsOptional()
  @IsISO8601()
  lastSyncAt?: string;
}

export class OcpiPartnerQueryDto {
  @IsOptional()
  @IsString()
  token?: string;
}

export class OcpiListQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}
