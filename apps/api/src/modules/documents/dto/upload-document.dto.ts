import { IsBoolean, IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';
import { Transform } from 'class-transformer';

// Enum definitions matching Prisma schema
export enum DocumentCategory {
    OWNERSHIP_PROOF = 'OWNERSHIP_PROOF',
    OWNER_IDENTITY = 'OWNER_IDENTITY',
    OWNER_ADDRESS_PROOF = 'OWNER_ADDRESS_PROOF',
    SITE_PHOTOS = 'SITE_PHOTOS',
    ELECTRICAL_CAPACITY = 'ELECTRICAL_CAPACITY',
    SITE_PLAN = 'SITE_PLAN',
    LAND_USE_PERMIT = 'LAND_USE_PERMIT',
    SOCIETY_NOC = 'SOCIETY_NOC',
    LENDER_CONSENT = 'LENDER_CONSENT',
    CO_OWNER_CONSENT = 'CO_OWNER_CONSENT',
    BUSINESS_REGISTRATION = 'BUSINESS_REGISTRATION',
    OPERATOR_IDENTITY = 'OPERATOR_IDENTITY',
    OPERATOR_ADDRESS_PROOF = 'OPERATOR_ADDRESS_PROOF',
    OPERATOR_PHOTO = 'OPERATOR_PHOTO',
    OPERATOR_BUSINESS_REG = 'OPERATOR_BUSINESS_REG',
    TAX_CERTIFICATE = 'TAX_CERTIFICATE',
    BANK_STATEMENTS = 'BANK_STATEMENTS',
    INSTALLATION_LICENSE = 'INSTALLATION_LICENSE',
    INSURANCE_CERTIFICATE = 'INSURANCE_CERTIFICATE',
    PORTFOLIO = 'PORTFOLIO',
    INSTALLATION_PLAN = 'INSTALLATION_PLAN',
    EQUIPMENT_SPECS = 'EQUIPMENT_SPECS',
    LEASE_AGREEMENT = 'LEASE_AGREEMENT',
    LEASE_REGISTRATION = 'LEASE_REGISTRATION',
    STAMP_DUTY_RECEIPT = 'STAMP_DUTY_RECEIPT',
    SECURITY_DEPOSIT_RECEIPT = 'SECURITY_DEPOSIT_RECEIPT',
    INDEMNITY_BOND = 'INDEMNITY_BOND',
    EXECUTED_LEASE = 'EXECUTED_LEASE',
    OTHER = 'OTHER',
}

export enum EntityType {
    SITE = 'SITE',
    APPLICATION = 'APPLICATION',
    TENANT = 'TENANT',
    USER = 'USER',
}

export class UploadDocumentDto {
    @IsEnum(EntityType)
    entityType: EntityType;

    @IsUUID()
    entityId: string;

    @IsEnum(DocumentCategory)
    category: DocumentCategory;

    @IsOptional()
    @IsBoolean()
    @Transform(({ value }) => value === 'true' || value === true)
    isRequired?: boolean;

    @IsOptional()
    @IsString()
    metadata?: string; // JSON string
}
