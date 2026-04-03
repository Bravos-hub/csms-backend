import {
  ArrayUnique,
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';

export class CreateTenantCustomRoleDto {
  @IsString()
  @IsOptional()
  key?: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsNotEmpty()
  baseRoleKey: string;

  @IsString()
  @IsOptional()
  status?: string;

  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  permissions: string[];
}

export class UpdateTenantCustomRoleDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  status?: string;

  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  @IsOptional()
  permissions?: string[];
}

export class AssignTenantMembershipDto {
  @IsString()
  @IsNotEmpty()
  userId: string;

  @IsString()
  @IsOptional()
  roleKey?: string;

  @IsString()
  @IsOptional()
  customRoleId?: string;

  @IsString()
  @IsOptional()
  status?: string;

  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  @IsOptional()
  siteIds?: string[];

  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  @IsOptional()
  stationIds?: string[];

  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  @IsOptional()
  fleetGroupIds?: string[];
}
