import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsEnum,
  IsNumber,
  IsLatitude,
  IsLongitude,
  IsArray,
  IsIn,
  IsInt,
  Min,
  Max,
  IsIP,
  IsBoolean,
  IsISO8601,
  IsUrl,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateStationDto {
  @IsString()
  @IsNotEmpty()
  code: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  address: string;

  @IsString()
  @IsNotEmpty()
  siteId: string;

  @IsLatitude()
  latitude: number;

  @IsLongitude()
  longitude: number;

  @IsEnum(['CHARGING', 'SWAP', 'BOTH'])
  @IsOptional()
  type?: 'CHARGING' | 'SWAP' | 'BOTH';

  @IsString()
  @IsOptional()
  orgId?: string;

  @IsString()
  @IsOptional()
  ownerId?: string;

  // New Fields
  @IsNumber()
  @IsOptional()
  rating?: number;

  @IsNumber()
  @IsOptional()
  price?: number;

  @IsString()
  @IsOptional()
  amenities?: string; // JSON string

  @IsString()
  @IsOptional()
  images?: string; // JSON string

  @IsOptional()
  open247?: boolean;

  @IsString()
  @IsOptional()
  phone?: string;

  @IsNumber()
  @IsOptional()
  bookingFee?: number;
}

export class UpdateStationDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  address?: string;

  @IsEnum(['ACTIVE', 'INACTIVE', 'MAINTENANCE'])
  @IsOptional()
  status?: 'ACTIVE' | 'INACTIVE' | 'MAINTENANCE';

  @IsString()
  @IsOptional()
  siteId?: string;

  @IsString()
  @IsOptional()
  orgId?: string;

  @IsString()
  @IsOptional()
  ownerId?: string;

  @IsNumber()
  @IsOptional()
  rating?: number;

  @IsNumber()
  @IsOptional()
  price?: number;

  @IsString()
  @IsOptional()
  amenities?: string;

  @IsString()
  @IsOptional()
  images?: string;

  @IsOptional()
  open247?: boolean;

  @IsString()
  @IsOptional()
  phone?: string;

  @IsNumber()
  @IsOptional()
  bookingFee?: number;
}

export class CreateChargePointDto {
  @IsString()
  @IsNotEmpty()
  ocppId: string;

  @IsString()
  @IsNotEmpty()
  stationId: string;

  @IsString()
  @IsOptional()
  model?: string;

  @IsString()
  @IsOptional()
  manufacturer?: string;

  @IsString()
  @IsOptional()
  serialNumber?: string;

  @IsString()
  @IsOptional()
  firmwareVersion?: string;

  @IsArray()
  @IsOptional()
  connectors?: Array<{
    type?: string;
    powerType?: 'AC' | 'DC';
    maxPowerKw?: number;
  }>;

  @IsString()
  @IsOptional()
  type?: string;

  @IsNumber()
  @IsOptional()
  power?: number;

  @IsEnum(['1.6', '2.0.1', '2.1'])
  @IsOptional()
  ocppVersion?: '1.6' | '2.0.1' | '2.1';

  @IsIn(['basic', 'mtls_bootstrap'])
  @IsOptional()
  authProfile?: 'basic' | 'mtls_bootstrap';

  @IsInt()
  @Min(1)
  @IsOptional()
  bootstrapTtlMinutes?: number;

  @IsArray()
  @IsIP(undefined, { each: true })
  @IsOptional()
  allowedIps?: string[];

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  allowedCidrs?: string[];
}

export class UpdateChargePointDto {
  @IsString()
  @IsOptional()
  model?: string;

  @IsString()
  @IsOptional()
  manufacturer?: string;

  @IsString()
  @IsOptional()
  firmwareVersion?: string;

  @IsString()
  @IsOptional()
  type?: string;

  @IsNumber()
  @IsOptional()
  power?: number;
}

export class ConfirmChargePointIdentityDto {
  @IsString()
  @IsNotEmpty()
  model: string;

  @IsString()
  @IsNotEmpty()
  manufacturer: string;

  @IsString()
  @IsNotEmpty()
  firmwareVersion: string;
}

export class SetChargePointPublicationDto {
  @IsBoolean()
  published: boolean;
}

export class BindChargePointCertificateDto {
  @IsString()
  @IsNotEmpty()
  fingerprint: string;

  @IsString()
  @IsOptional()
  subject?: string;

  @IsString()
  @IsOptional()
  validFrom?: string;

  @IsString()
  @IsOptional()
  validTo?: string;
}

export class UpdateChargePointBootstrapDto {
  @IsBoolean()
  enabled: boolean;

  @IsInt()
  @Min(1)
  @IsOptional()
  ttlMinutes?: number;

  @IsArray()
  @IsIP(undefined, { each: true })
  @IsOptional()
  allowedIps?: string[];

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  allowedCidrs?: string[];
}

export class RemoteStartChargePointCommandDto {
  @IsInt()
  @Min(1)
  @IsOptional()
  connectorId?: number;

  @IsInt()
  @Min(1)
  @IsOptional()
  evseId?: number;

  @IsString()
  @IsNotEmpty()
  @IsOptional()
  idTag?: string;

  @IsInt()
  @Min(1)
  @IsOptional()
  remoteStartId?: number;
}

export class UnlockChargePointCommandDto {
  @IsInt()
  @Min(1)
  @IsOptional()
  connectorId?: number;

  @IsInt()
  @Min(1)
  @IsOptional()
  evseId?: number;
}

export class UpdateFirmwareChargePointCommandDto {
  @IsString()
  @IsNotEmpty()
  @IsUrl(
    {
      require_protocol: true,
      protocols: ['https'],
    },
    { message: 'location must be a valid https URL' },
  )
  location: string;

  @IsString()
  @IsNotEmpty()
  @IsISO8601()
  retrieveAt: string;

  @IsString()
  @IsOptional()
  @IsISO8601()
  installAt?: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @IsOptional()
  retries?: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @IsOptional()
  retryIntervalSec?: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  requestId?: number;

  @IsString()
  @IsOptional()
  signingCertificate?: string;

  @IsString()
  @IsOptional()
  signature?: string;
}

export class FirmwareEventHistoryQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  @IsOptional()
  limit?: number;

  @IsString()
  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsString()
  @IsOptional()
  @IsISO8601()
  to?: string;
}
