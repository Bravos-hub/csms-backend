import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { ZoneType } from '@prisma/client';

const ZONE_CODE_PATTERN = /^[A-Z0-9]+(?:[-_][A-Z0-9]+)*$/;

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeZoneCode(value: unknown): string | undefined {
  const normalized = normalizeOptionalString(value);
  if (!normalized) return undefined;
  return normalized.toUpperCase().replace(/\s+/g, '-');
}

function normalizeBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  return undefined;
}

export class GetZonesQueryDto {
  @IsOptional()
  @Transform(({ value }) => normalizeOptionalString(value))
  @IsString()
  parentId?: string;

  @IsOptional()
  @IsEnum(ZoneType)
  type?: ZoneType;

  @IsOptional()
  @Transform(({ value }) => normalizeBoolean(value))
  @IsBoolean()
  active?: boolean;
}

export class CreateGeographicZoneDto {
  @Transform(({ value }) => normalizeZoneCode(value))
  @IsString()
  @Matches(ZONE_CODE_PATTERN, {
    message:
      'code must contain only uppercase letters, numbers, dashes, or underscores',
  })
  @MaxLength(64)
  code!: string;

  @Transform(({ value }) => normalizeOptionalString(value))
  @IsString()
  @MaxLength(120)
  name!: string;

  @IsEnum(ZoneType)
  type!: ZoneType;

  @IsOptional()
  @Transform(({ value }) => normalizeOptionalString(value))
  @IsString()
  parentId?: string;

  @IsOptional()
  @Transform(({ value }) => normalizeOptionalString(value))
  @IsString()
  @MaxLength(16)
  currency?: string;

  @IsOptional()
  @Transform(({ value }) => normalizeOptionalString(value))
  @IsString()
  @MaxLength(80)
  timezone?: string;

  @IsOptional()
  @Transform(({ value }) => normalizeOptionalString(value))
  @IsString()
  @MaxLength(255)
  postalCodeRegex?: string;
}

export class UpdateGeographicZoneDto {
  @IsOptional()
  @Transform(({ value }) => normalizeZoneCode(value))
  @IsString()
  @Matches(ZONE_CODE_PATTERN, {
    message:
      'code must contain only uppercase letters, numbers, dashes, or underscores',
  })
  @MaxLength(64)
  code?: string;

  @IsOptional()
  @Transform(({ value }) => normalizeOptionalString(value))
  @IsString()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsEnum(ZoneType)
  type?: ZoneType;

  @IsOptional()
  @Transform(({ value }) => normalizeOptionalString(value))
  @IsString()
  parentId?: string;

  @IsOptional()
  @Transform(({ value }) => normalizeOptionalString(value))
  @IsString()
  @MaxLength(16)
  currency?: string | null;

  @IsOptional()
  @Transform(({ value }) => normalizeOptionalString(value))
  @IsString()
  @MaxLength(80)
  timezone?: string | null;

  @IsOptional()
  @Transform(({ value }) => normalizeOptionalString(value))
  @IsString()
  @MaxLength(255)
  postalCodeRegex?: string | null;
}

export class UpdateGeographicZoneStatusDto {
  @Transform(({ value }) => normalizeBoolean(value))
  @IsBoolean()
  isActive!: boolean;
}
