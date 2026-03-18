import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class OcpiPartnerListQueryDto {
  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  role?: string;
}

export class OcpiPartnerCreateRequestDto {
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
}

export class OcpiPartnerUpdateRequestDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  role?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  versionsUrl?: string;

  @IsOptional()
  @IsArray()
  roles?: Record<string, unknown>[];

  @IsOptional()
  @IsArray()
  endpoints?: Record<string, unknown>[];
}

export class OcpiRoamingListQueryDto {
  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @IsString()
  partner?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  role?: string;

  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;

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

export class OcpiRoamingPublicationDto {
  @IsBoolean()
  published: boolean;
}

export class OcpiPartnerSyncRequestDto {
  @IsOptional()
  @IsObject()
  force?: Record<string, unknown>;
}
