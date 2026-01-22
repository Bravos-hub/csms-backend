import { IsString, IsNumber, IsOptional, IsEnum, IsBoolean, IsArray, ValidateNested, IsNotEmpty, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

export enum MaintenanceResponsibility {
    OWNER = 'OWNER',
    OPERATOR = 'OPERATOR',
    SHARED = 'SHARED',
}

export enum UtilitiesResponsibility {
    OWNER = 'OWNER',
    OPERATOR = 'OPERATOR',
}

export class LeaseTermsDto {
    @IsNumber()
    @Min(0)
    monthlyRent: number;

    @IsString()
    @IsNotEmpty()
    currency: string;

    @IsNumber()
    @Min(1)
    leaseDuration: number; // in months

    @IsNumber()
    @IsOptional()
    @Min(0)
    @Max(100)
    revenueSharePercent?: number;

    @IsNumber()
    @Min(0)
    securityDepositMonths: number;

    @IsEnum(MaintenanceResponsibility)
    maintenanceResponsibility: MaintenanceResponsibility;

    @IsEnum(UtilitiesResponsibility)
    utilitiesResponsibility: UtilitiesResponsibility;

    @IsNumber()
    @Min(0)
    noticePerodDays: number;

    @IsBoolean()
    renewalOption: boolean;

    @IsArray()
    @IsString({ each: true })
    @IsOptional()
    customClauses?: string[];
}

export class CreateNegotiationDto {
    @ValidateNested()
    @Type(() => LeaseTermsDto)
    terms: LeaseTermsDto;

    @IsString()
    @IsOptional()
    message?: string;
}

export class CounterProposalDto {
    @ValidateNested()
    @Type(() => LeaseTermsDto)
    terms: LeaseTermsDto;

    @IsString()
    @IsOptional()
    message?: string;
}

export class RejectProposalDto {
    @IsString()
    @IsNotEmpty()
    reason: string;
}

export class AcceptProposalDto {
    @IsString()
    @IsOptional()
    message?: string;
}
