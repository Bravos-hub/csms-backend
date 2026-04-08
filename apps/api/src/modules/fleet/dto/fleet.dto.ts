import {
  IsArray,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

const FLEET_ENTITY_STATUS = ['ACTIVE', 'INACTIVE', 'SUSPENDED'] as const;

export class FleetListQueryDto {
  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  fleetAccountId?: string;

  @IsOptional()
  @IsString()
  groupId?: string;

  @IsOptional()
  @IsString()
  search?: string;
}

export class CreateFleetAccountDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  code?: string;

  @IsOptional()
  @IsString()
  @IsIn(FLEET_ENTITY_STATUS)
  status?: (typeof FLEET_ENTITY_STATUS)[number];

  @IsOptional()
  @IsString()
  @MaxLength(8)
  currency?: string;

  @IsOptional()
  @IsNumber()
  monthlySpendLimit?: number;

  @IsOptional()
  @IsNumber()
  dailySpendLimit?: number;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class UpdateFleetAccountDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  code?: string;

  @IsOptional()
  @IsString()
  @IsIn(FLEET_ENTITY_STATUS)
  status?: (typeof FLEET_ENTITY_STATUS)[number];

  @IsOptional()
  @IsString()
  @MaxLength(8)
  currency?: string;

  @IsOptional()
  @IsNumber()
  monthlySpendLimit?: number;

  @IsOptional()
  @IsNumber()
  dailySpendLimit?: number;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class CreateFleetDriverGroupDto {
  @IsString()
  @IsNotEmpty()
  fleetAccountId: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(280)
  description?: string;

  @IsOptional()
  @IsString()
  @IsIn(FLEET_ENTITY_STATUS)
  status?: (typeof FLEET_ENTITY_STATUS)[number];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tariffIds?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  locationIds?: string[];

  @IsOptional()
  @IsNumber()
  monthlySpendLimit?: number;

  @IsOptional()
  @IsNumber()
  dailySpendLimit?: number;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class UpdateFleetDriverGroupDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(280)
  description?: string;

  @IsOptional()
  @IsString()
  @IsIn(FLEET_ENTITY_STATUS)
  status?: (typeof FLEET_ENTITY_STATUS)[number];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tariffIds?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  locationIds?: string[];

  @IsOptional()
  @IsNumber()
  monthlySpendLimit?: number;

  @IsOptional()
  @IsNumber()
  dailySpendLimit?: number;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class CreateFleetDriverDto {
  @IsString()
  @IsNotEmpty()
  fleetAccountId: string;

  @IsOptional()
  @IsString()
  groupId?: string;

  @IsOptional()
  @IsString()
  userId?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  displayName: string;

  @IsOptional()
  @IsString()
  @MaxLength(180)
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  externalRef?: string;

  @IsOptional()
  @IsString()
  @IsIn(FLEET_ENTITY_STATUS)
  status?: (typeof FLEET_ENTITY_STATUS)[number];

  @IsOptional()
  @IsNumber()
  monthlySpendLimit?: number;

  @IsOptional()
  @IsNumber()
  dailySpendLimit?: number;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class UpdateFleetDriverDto {
  @IsOptional()
  @IsString()
  groupId?: string;

  @IsOptional()
  @IsString()
  userId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  displayName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(180)
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  externalRef?: string;

  @IsOptional()
  @IsString()
  @IsIn(FLEET_ENTITY_STATUS)
  status?: (typeof FLEET_ENTITY_STATUS)[number];

  @IsOptional()
  @IsNumber()
  monthlySpendLimit?: number;

  @IsOptional()
  @IsNumber()
  dailySpendLimit?: number;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class AssignFleetDriverTokenDto {
  @IsString()
  @IsNotEmpty()
  tokenUid: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  tokenType?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class RevokeFleetDriverTokenDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;
}
