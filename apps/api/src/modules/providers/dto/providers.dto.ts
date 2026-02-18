import { Transform } from 'class-transformer'
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEmail,
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  Min,
} from 'class-validator'
import {
  ProviderDocumentStatus,
  ProviderDocumentType,
  ProviderRelationshipStatus,
  ProviderSettlementStatus,
  SwapProviderStatus,
} from '@prisma/client'

const toBoolean = ({ value }: { value: unknown }) => value === true || value === 'true' || value === '1'

const toInt = ({ value }: { value: unknown }) => {
  if (value == null || value === '') return undefined
  const parsed = Number(value)
  return Number.isNaN(parsed) ? value : parsed
}

const toStringArray = ({ value }: { value: unknown }) => {
  if (value == null || value === '') return undefined
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean)
  if (typeof value === 'string') return value.split(',').map((item) => item.trim()).filter(Boolean)
  return undefined
}

export class ProviderListQueryDto {
  @IsOptional()
  @IsString()
  region?: string

  @IsOptional()
  @IsString()
  standard?: string

  @IsOptional()
  @IsEnum(SwapProviderStatus)
  status?: SwapProviderStatus

  @IsOptional()
  @IsString()
  orgId?: string

  @IsOptional()
  @IsString()
  ownerOrgId?: string

  @IsOptional()
  @IsEnum(ProviderRelationshipStatus)
  relationshipStatus?: ProviderRelationshipStatus

  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  includeOnlyEligible?: boolean

  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  my?: boolean
}

export class CreateProviderDto {
  @IsString()
  name: string

  @IsOptional()
  @IsUrl({ require_tld: false }, { message: 'logoUrl must be a valid URL' })
  logoUrl?: string

  @IsOptional()
  @IsString()
  legalName?: string

  @IsOptional()
  @IsString()
  registrationNumber?: string

  @IsOptional()
  @IsString()
  taxId?: string

  @IsOptional()
  @IsEmail()
  contactEmail?: string

  @IsOptional()
  @IsString()
  contactPhone?: string

  @IsString()
  region: string

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  regions?: string[]

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  countries?: string[]

  @IsOptional()
  @IsString()
  organizationId?: string

  @IsString()
  standard: string

  @IsArray()
  @IsString({ each: true })
  batteriesSupported: string[]

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  supportedStationTypes?: string[]

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  protocolCapabilities?: string[]

  @IsOptional()
  @IsString()
  feeModel?: string

  @IsOptional()
  @IsString()
  settlementTerms?: string

  @IsOptional()
  @IsInt()
  @Min(0)
  stationCount?: number

  @IsOptional()
  @IsUrl({ require_tld: false }, { message: 'website must be a valid URL' })
  website?: string

  @IsOptional()
  @IsArray()
  @IsEnum(ProviderDocumentType, { each: true })
  requiredDocuments?: ProviderDocumentType[]

  @IsOptional()
  @Transform(toStringArray)
  @IsArray()
  @IsString({ each: true })
  complianceMarkets?: string[]

  @IsOptional()
  @IsObject()
  complianceProfile?: Record<string, unknown>

  @IsOptional()
  @IsDateString()
  partnerSince?: string
}

export class UpdateProviderDto {
  @IsOptional()
  @IsString()
  name?: string

  @IsOptional()
  @IsUrl({ require_tld: false }, { message: 'logoUrl must be a valid URL' })
  logoUrl?: string

  @IsOptional()
  @IsString()
  legalName?: string

  @IsOptional()
  @IsString()
  registrationNumber?: string

  @IsOptional()
  @IsString()
  taxId?: string

  @IsOptional()
  @IsEmail()
  contactEmail?: string

  @IsOptional()
  @IsString()
  contactPhone?: string

  @IsOptional()
  @IsString()
  region?: string

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  regions?: string[]

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  countries?: string[]

  @IsOptional()
  @IsString()
  organizationId?: string

  @IsOptional()
  @IsString()
  standard?: string

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  batteriesSupported?: string[]

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  supportedStationTypes?: string[]

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  protocolCapabilities?: string[]

  @IsOptional()
  @IsString()
  feeModel?: string

  @IsOptional()
  @IsString()
  settlementTerms?: string

  @IsOptional()
  @IsInt()
  @Min(0)
  stationCount?: number

  @IsOptional()
  @IsUrl({ require_tld: false }, { message: 'website must be a valid URL' })
  website?: string

  @IsOptional()
  @IsArray()
  @IsEnum(ProviderDocumentType, { each: true })
  requiredDocuments?: ProviderDocumentType[]

  @IsOptional()
  @Transform(toStringArray)
  @IsArray()
  @IsString({ each: true })
  complianceMarkets?: string[]

  @IsOptional()
  @IsObject()
  complianceProfile?: Record<string, unknown>
}

export class ProviderRejectBodyDto {
  @IsString()
  reason: string
}

export class ProviderSuspendBodyDto {
  @IsOptional()
  @IsString()
  reason?: string
}

export class ProviderNotesBodyDto {
  @IsOptional()
  @IsString()
  notes?: string
}

export class ProviderRelationshipsQueryDto {
  @IsOptional()
  @IsString()
  ownerOrgId?: string

  @IsOptional()
  @IsString()
  providerId?: string

  @IsOptional()
  @IsEnum(ProviderRelationshipStatus)
  status?: ProviderRelationshipStatus

  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  my?: boolean
}

export class CreateProviderRelationshipDto {
  @IsString()
  providerId: string

  @IsString()
  ownerOrgId: string

  @IsOptional()
  @IsString()
  notes?: string

  @IsOptional()
  @Transform(toStringArray)
  @IsArray()
  @IsString({ each: true })
  complianceMarkets?: string[]

  @IsOptional()
  @IsObject()
  complianceProfile?: Record<string, unknown>
}

export class RespondProviderRelationshipDto {
  @IsIn(['ACCEPT', 'REJECT'])
  action: 'ACCEPT' | 'REJECT'

  @IsOptional()
  @IsString()
  notes?: string
}

export class SuspendProviderRelationshipDto {
  @IsOptional()
  @IsString()
  reason?: string
}

export class TerminateProviderRelationshipDto {
  @IsOptional()
  @IsString()
  reason?: string
}

export class ProviderDocumentsQueryDto {
  @IsOptional()
  @IsString()
  providerId?: string

  @IsOptional()
  @IsString()
  relationshipId?: string

  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  my?: boolean
}

export class CreateProviderDocumentDto {
  @IsOptional()
  @IsString()
  providerId?: string

  @IsOptional()
  @IsString()
  relationshipId?: string

  @IsEnum(ProviderDocumentType)
  type: ProviderDocumentType

  @IsString()
  name: string

  @IsUrl({ require_tld: false }, { message: 'fileUrl must be a valid URL' })
  fileUrl: string

  @IsOptional()
  @IsString()
  requirementCode?: string

  @IsOptional()
  @IsString()
  category?: string

  @IsOptional()
  @IsString()
  issuer?: string

  @IsOptional()
  @IsString()
  documentNumber?: string

  @IsOptional()
  @IsDateString()
  issueDate?: string

  @IsOptional()
  @IsDateString()
  expiryDate?: string

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  coveredModels?: string[]

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  coveredSites?: string[]

  @IsOptional()
  @IsString()
  version?: string

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>

  /**
   * @deprecated Use POST /provider-documents/upload for native file uploads.
   */
}

export class ReviewProviderDocumentDto {
  @IsEnum(ProviderDocumentStatus)
  status: ProviderDocumentStatus

  @IsOptional()
  @IsString()
  reviewedBy?: string

  @IsOptional()
  @IsString()
  reviewNotes?: string

  @IsOptional()
  @IsString()
  rejectionReason?: string
}

export class UploadProviderDocumentDto {
  @IsOptional()
  @IsString()
  providerId?: string

  @IsOptional()
  @IsString()
  relationshipId?: string

  @IsEnum(ProviderDocumentType)
  type: ProviderDocumentType

  @IsString()
  name: string

  @IsOptional()
  @IsString()
  requirementCode?: string

  @IsOptional()
  @IsString()
  category?: string

  @IsOptional()
  @IsString()
  issuer?: string

  @IsOptional()
  @IsString()
  documentNumber?: string

  @IsOptional()
  @IsDateString()
  issueDate?: string

  @IsOptional()
  @IsDateString()
  expiryDate?: string

  @IsOptional()
  @Transform(toStringArray)
  @IsArray()
  @IsString({ each: true })
  coveredModels?: string[]

  @IsOptional()
  @Transform(toStringArray)
  @IsArray()
  @IsString({ each: true })
  coveredSites?: string[]

  @IsOptional()
  @IsString()
  version?: string

  @IsOptional()
  @IsString()
  metadata?: string
}

export class ProviderRequirementsQueryDto {
  @IsOptional()
  @IsIn(['PROVIDER', 'STATION_OWNER'])
  appliesTo?: 'PROVIDER' | 'STATION_OWNER'
}

export class UpdateComplianceProfileDto {
  @IsOptional()
  @Transform(toStringArray)
  @IsArray()
  @IsString({ each: true })
  complianceMarkets?: string[]

  @IsOptional()
  @IsObject()
  complianceProfile?: Record<string, unknown>
}

export class ProviderComplianceStatusesQueryDto {
  @Transform(toStringArray)
  @IsArray()
  @IsString({ each: true })
  providerIds: string[]
}

export class RelationshipComplianceStatusesQueryDto {
  @Transform(toStringArray)
  @IsArray()
  @IsString({ each: true })
  relationshipIds: string[]
}

export class UpdateCompliancePolicyDto {
  @IsOptional()
  @IsString()
  effectiveDateMode?: 'WARN_BEFORE_ENFORCE' | 'ENFORCE_NOW'

  @IsOptional()
  @IsBoolean()
  roadmapAllowedBeforeEffective?: boolean

  @IsOptional()
  @Transform(toStringArray)
  @IsArray()
  @IsString({ each: true })
  markets?: string[]

  @IsOptional()
  @IsObject()
  hk?: Record<string, unknown>
}

export class ProviderSettlementSummaryQueryDto {
  @IsOptional()
  @IsString()
  providerId?: string

  @IsOptional()
  @IsString()
  ownerOrgId?: string

  @IsOptional()
  @IsDateString()
  startDate?: string

  @IsOptional()
  @IsDateString()
  endDate?: string

  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  my?: boolean
}

export class CreateProviderSettlementEntryDto {
  @IsOptional()
  @IsString()
  relationshipId?: string

  @IsString()
  providerId: string

  @IsOptional()
  @IsString()
  ownerOrgId?: string

  @IsOptional()
  @IsString()
  stationId?: string

  @IsOptional()
  @IsString()
  sessionId?: string

  @IsNumber()
  amount: number

  @IsNumber()
  providerFee: number

  @IsNumber()
  platformFee: number

  @IsOptional()
  @IsNumber()
  adjustment?: number

  @IsNumber()
  net: number

  @IsOptional()
  @IsString()
  currency?: string

  @IsOptional()
  @IsEnum(ProviderSettlementStatus)
  status?: ProviderSettlementStatus
}
