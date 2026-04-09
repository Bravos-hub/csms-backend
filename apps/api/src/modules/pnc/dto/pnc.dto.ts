import {
  ArrayMaxSize,
  IsArray,
  IsISO8601,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
} from 'class-validator';

export class PncListContractsQueryDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  status?: string;
}

export class CreatePncContractDto {
  @IsString()
  @IsNotEmpty()
  contractRef: string;

  @IsOptional()
  @IsString()
  eMobilityAccountId?: string;

  @IsOptional()
  @IsString()
  providerPartyId?: string;

  @IsOptional()
  @IsString()
  vehicleVin?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class UpdatePncContractDto {
  @IsOptional()
  @IsString()
  eMobilityAccountId?: string;

  @IsOptional()
  @IsString()
  providerPartyId?: string;

  @IsOptional()
  @IsString()
  vehicleVin?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class IssuePncCertificateDto {
  @IsString()
  @IsNotEmpty()
  certificateHash: string;

  @IsOptional()
  @IsString()
  certificateType?: string;

  @IsOptional()
  @IsISO8601()
  validFrom?: string;

  @IsOptional()
  @IsISO8601()
  validTo?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  mappedChargePointIds?: string[];

  @IsOptional()
  @IsObject()
  diagnostics?: Record<string, unknown>;
}

export class RevokePncCertificateDto {
  @IsOptional()
  @IsString()
  reason?: string;
}
