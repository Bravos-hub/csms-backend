import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

export enum SitePurpose {
  PERSONAL = 'PERSONAL',
  COMMERCIAL = 'COMMERCIAL',
}

export enum LeaseType {
  REVENUE_SHARE = 'REVENUE_SHARE',
  FIXED_RENT = 'FIXED_RENT',
  HYBRID = 'HYBRID',
}

export enum Footfall {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  VERY_HIGH = 'VERY_HIGH',
}

const leaseStatuses = ['PENDING', 'ACTIVE', 'INACTIVE'] as const;
export type LeaseStatus = (typeof leaseStatuses)[number];

export class SiteLeaseDetailsDto {
  @IsEnum(LeaseType)
  leaseType: LeaseType;

  @Type(() => Number)
  @IsNumber()
  @IsOptional()
  expectedMonthlyPrice?: number;

  @IsEnum(Footfall)
  expectedFootfall: Footfall;

  @IsEnum(leaseStatuses)
  @IsOptional()
  status?: LeaseStatus;
}

export class CreateSiteDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  city: string;

  @IsString()
  @IsNotEmpty()
  address: string;

  @Type(() => Number)
  @IsNumber()
  powerCapacityKw: number;

  @Type(() => Number)
  @IsNumber()
  parkingBays: number;

  @IsEnum(SitePurpose)
  @IsOptional()
  purpose?: SitePurpose;

  @Type(() => Number)
  @IsNumber()
  @IsOptional()
  latitude?: number;

  @Type(() => Number)
  @IsNumber()
  @IsOptional()
  longitude?: number;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  photos?: string[];

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  amenities?: string[];

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  tags?: string[];

  @IsString()
  @IsNotEmpty()
  ownerId: string;

  // Optional lease details - only if listing for lease
  @ValidateNested()
  @Type(() => SiteLeaseDetailsDto)
  @IsOptional()
  leaseDetails?: SiteLeaseDetailsDto;
}

export class UpdateSiteDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  city?: string;

  @IsString()
  @IsOptional()
  address?: string;

  @Type(() => Number)
  @IsNumber()
  @IsOptional()
  powerCapacityKw?: number;

  @Type(() => Number)
  @IsNumber()
  @IsOptional()
  parkingBays?: number;

  @IsEnum(SitePurpose)
  @IsOptional()
  purpose?: SitePurpose;

  @Type(() => Number)
  @IsNumber()
  @IsOptional()
  latitude?: number;

  @Type(() => Number)
  @IsNumber()
  @IsOptional()
  longitude?: number;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  photos?: string[];

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  amenities?: string[];

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  tags?: string[];

  @IsOptional()
  @IsString()
  ownerId?: string;

  // Optional lease details - only if listing for lease
  @ValidateNested()
  @Type(() => SiteLeaseDetailsDto)
  @IsOptional()
  leaseDetails?: SiteLeaseDetailsDto;
}
