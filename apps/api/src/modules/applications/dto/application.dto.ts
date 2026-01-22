import {
    IsInt,
    IsNotEmpty,
    IsOptional,
    IsString,
    IsArray,
    IsEmail,
    IsNumber,
    IsEnum,
} from 'class-validator';
import { Type } from 'class-transformer';

import { ApplicationStatus } from '@prisma/client';

export class CreateApplicationDto {
    @IsString()
    @IsNotEmpty()
    organizationName: string;

    @IsString()
    @IsNotEmpty()
    businessRegistrationNumber: string;

    @IsString()
    @IsOptional()
    taxComplianceNumber?: string;

    @IsString()
    @IsNotEmpty()
    contactPersonName: string;

    @IsEmail()
    @IsNotEmpty()
    contactEmail: string;

    @IsString()
    @IsNotEmpty()
    contactPhone: string;

    @IsString()
    @IsNotEmpty()
    physicalAddress: string;

    @IsString()
    @IsOptional()
    companyWebsite?: string;

    @IsString()
    @IsNotEmpty()
    yearsInEVBusiness: string; // '<1', '1-3', '3-5', '5+'

    @Type(() => Number)
    @IsInt()
    @IsOptional()
    existingStationsOperated?: number;

    @IsString()
    @IsNotEmpty()
    siteId: string;

    @IsString()
    @IsNotEmpty()
    preferredLeaseModel: string; // 'Revenue Share' | 'Fixed Rent' | 'Hybrid'

    @IsString()
    @IsNotEmpty()
    businessPlanSummary: string;

    @IsString()
    @IsOptional()
    sustainabilityCommitments?: string;

    @IsArray()
    @IsOptional()
    additionalServices?: string[];

    @IsString()
    @IsOptional()
    estimatedStartDate?: string;

    @IsString()
    @IsOptional()
    message?: string;
}

export class UpdateApplicationStatusDto {
    @IsEnum(ApplicationStatus)
    @IsNotEmpty()
    status: ApplicationStatus;

    @IsString()
    @IsOptional()
    message?: string;
}

export class ReviewApplicationDto {
    @IsEnum(ApplicationStatus)
    @IsNotEmpty()
    status: ApplicationStatus; // APPROVED | REJECTED | INFO_REQUESTED

    @IsString()
    @IsOptional()
    notes?: string;

    @IsArray()
    @IsOptional()
    requiredDocuments?: string[];
}

export class RequestInfoDto {
    @IsString()
    @IsNotEmpty()
    message: string;

    @IsArray()
    @IsOptional()
    requiredDocuments?: string[];
}

export class UpdateApplicationTermsDto {
    @Type(() => Number)
    @IsNumber()
    @IsNotEmpty()
    proposedRent: number;

    @Type(() => Number)
    @IsInt()
    @IsNotEmpty()
    proposedTerm: number; // months

    @Type(() => Number)
    @IsInt()
    @IsNotEmpty()
    numberOfChargingPoints: number;

    @Type(() => Number)
    @IsNumber()
    @IsNotEmpty()
    totalPowerRequirement: number; // kW

    @IsArray()
    @IsNotEmpty()
    chargingTechnology: string[];

    @IsArray()
    @IsNotEmpty()
    targetCustomerSegment: string[];
}
