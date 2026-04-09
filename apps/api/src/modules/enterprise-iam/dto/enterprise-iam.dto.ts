import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class ListEnterpriseProvidersQueryDto {
  @IsOptional()
  @IsString()
  protocol?: string;

  @IsOptional()
  @IsString()
  status?: string;
}

export class ListEnterpriseSyncJobsQueryDto {
  @IsOptional()
  @IsString()
  providerId?: string;

  @IsOptional()
  @IsString()
  status?: string;
}

export class CreateEnterpriseIdentityProviderDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  protocol: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  issuerUrl?: string;

  @IsOptional()
  @IsString()
  authorizationUrl?: string;

  @IsOptional()
  @IsString()
  tokenUrl?: string;

  @IsOptional()
  @IsString()
  userInfoUrl?: string;

  @IsOptional()
  @IsString()
  jwksUrl?: string;

  @IsOptional()
  @IsString()
  samlMetadataUrl?: string;

  @IsOptional()
  @IsString()
  samlEntityId?: string;

  @IsOptional()
  @IsString()
  samlAcsUrl?: string;

  @IsOptional()
  @IsString()
  clientId?: string;

  @IsOptional()
  @IsString()
  clientSecretRef?: string;

  @IsOptional()
  @IsString()
  syncMode?: string;

  @IsOptional()
  @IsObject()
  roleMappings?: Record<string, string[]>;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class UpdateEnterpriseIdentityProviderDto {
  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  issuerUrl?: string;

  @IsOptional()
  @IsString()
  authorizationUrl?: string;

  @IsOptional()
  @IsString()
  tokenUrl?: string;

  @IsOptional()
  @IsString()
  userInfoUrl?: string;

  @IsOptional()
  @IsString()
  jwksUrl?: string;

  @IsOptional()
  @IsString()
  samlMetadataUrl?: string;

  @IsOptional()
  @IsString()
  samlEntityId?: string;

  @IsOptional()
  @IsString()
  samlAcsUrl?: string;

  @IsOptional()
  @IsString()
  clientId?: string;

  @IsOptional()
  @IsString()
  clientSecretRef?: string;

  @IsOptional()
  @IsString()
  syncMode?: string;

  @IsOptional()
  @IsObject()
  roleMappings?: Record<string, string[]>;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class UpdateEnterpriseRoleMappingsDto {
  @IsObject()
  roleMappings: Record<string, string[]>;
}

export class EnterpriseSyncImportUserDto {
  @IsOptional()
  @IsString()
  externalId?: string;

  @IsEmail()
  email: string;

  @IsOptional()
  @IsString()
  displayName?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  groups?: string[];

  @IsOptional()
  @IsString()
  mappedRoleKey?: string;
}

export class EnterpriseSyncImportGroupDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsOptional()
  @IsString()
  externalId?: string;

  @IsOptional()
  @IsString()
  mappedRoleKey?: string;
}

export class CreateEnterpriseSyncImportJobDto {
  @IsOptional()
  @IsString()
  mode?: string;

  @IsOptional()
  @IsBoolean()
  includeGroupsOnly?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(2000)
  @ValidateNested({ each: true })
  @Type(() => EnterpriseSyncImportUserDto)
  users?: EnterpriseSyncImportUserDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => EnterpriseSyncImportGroupDto)
  groups?: EnterpriseSyncImportGroupDto[];
}
