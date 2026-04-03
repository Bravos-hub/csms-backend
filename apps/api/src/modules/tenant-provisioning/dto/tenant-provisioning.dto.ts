import {
  IsArray,
  IsBoolean,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
} from 'class-validator';

export class CreatePlatformTenantDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  type?: string;

  @IsString()
  @IsOptional()
  tenantSubdomain?: string;

  @IsString()
  @IsOptional()
  tenantTier?: string;

  @IsString()
  @IsOptional()
  tenantSchema?: string;

  @IsBoolean()
  @IsOptional()
  tenantRoutingEnabled?: boolean;

  @IsString()
  @IsOptional()
  primaryDomain?: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  allowedOrigins?: string[];

  @IsObject()
  @IsOptional()
  whiteLabelConfig?: Record<string, unknown>;

  @IsString()
  @IsOptional()
  billingPlanCode?: string;

  @IsString()
  @IsOptional()
  billingStatus?: string;
}

export class UpdatePlatformTenantDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  type?: string;

  @IsString()
  @IsOptional()
  tenantSubdomain?: string;

  @IsString()
  @IsOptional()
  tenantTier?: string;

  @IsString()
  @IsOptional()
  tenantSchema?: string;

  @IsBoolean()
  @IsOptional()
  tenantRoutingEnabled?: boolean;

  @IsString()
  @IsOptional()
  primaryDomain?: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  allowedOrigins?: string[];

  @IsObject()
  @IsOptional()
  whiteLabelConfig?: Record<string, unknown>;

  @IsString()
  @IsOptional()
  billingPlanCode?: string;

  @IsString()
  @IsOptional()
  billingStatus?: string;
}

export class SuspendTenantDto {
  @IsBoolean()
  suspended: boolean;
}

export class AssignPlatformRoleDto {
  @IsString()
  @IsNotEmpty()
  roleKey: string;

  @IsString()
  @IsOptional()
  status?: string;
}
