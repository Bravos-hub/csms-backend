import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { TenantAccountType } from '@prisma/client';

export const ONBOARDING_TIER_CODES = ['T1', 'T2', 'T3', 'T4'] as const;
export type OnboardingTierCode = (typeof ONBOARDING_TIER_CODES)[number];

export const ONBOARDING_BILLING_CYCLES = ['MONTHLY', 'ANNUAL'] as const;
export type OnboardingBillingCycle = (typeof ONBOARDING_BILLING_CYCLES)[number];

export const REVIEW_ACTIONS = ['UNDER_REVIEW', 'APPROVE', 'REJECT'] as const;
export type ReviewAction = (typeof REVIEW_ACTIONS)[number];

export class CreateApplicationDto {
  @IsEnum(TenantAccountType)
  @IsOptional()
  tenantType?: TenantAccountType;

  @IsString()
  @IsNotEmpty()
  organizationName: string;

  @IsString()
  @IsOptional()
  businessRegistrationNumber?: string;

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
  @IsOptional()
  yearsInEVBusiness?: string;

  @Type(() => Number)
  @IsInt()
  @IsOptional()
  existingStationsOperated?: number;

  @IsString()
  @IsOptional()
  siteId?: string;

  @IsString()
  @IsOptional()
  preferredLeaseModel?: string;

  @IsString()
  @IsOptional()
  businessPlanSummary?: string;

  @IsString()
  @IsOptional()
  sustainabilityCommitments?: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  additionalServices?: string[];

  @IsString()
  @IsOptional()
  estimatedStartDate?: string;

  @IsString()
  @IsOptional()
  message?: string;

  @IsString()
  @IsOptional()
  applicantPreferredSubdomain?: string;

  @IsString()
  @IsOptional()
  applicantPreferredDomain?: string;
}

export class UpdateOwnApplicationDto {
  @IsEnum(TenantAccountType)
  @IsOptional()
  tenantType?: TenantAccountType;

  @IsString()
  @IsOptional()
  organizationName?: string;

  @IsString()
  @IsOptional()
  businessRegistrationNumber?: string;

  @IsString()
  @IsOptional()
  taxComplianceNumber?: string;

  @IsString()
  @IsOptional()
  contactPersonName?: string;

  @IsEmail()
  @IsOptional()
  contactEmail?: string;

  @IsString()
  @IsOptional()
  contactPhone?: string;

  @IsString()
  @IsOptional()
  physicalAddress?: string;

  @IsString()
  @IsOptional()
  companyWebsite?: string;

  @IsString()
  @IsOptional()
  yearsInEVBusiness?: string;

  @Type(() => Number)
  @IsInt()
  @IsOptional()
  existingStationsOperated?: number;

  @IsString()
  @IsOptional()
  siteId?: string;

  @IsString()
  @IsOptional()
  preferredLeaseModel?: string;

  @IsString()
  @IsOptional()
  businessPlanSummary?: string;

  @IsString()
  @IsOptional()
  sustainabilityCommitments?: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  additionalServices?: string[];

  @IsString()
  @IsOptional()
  estimatedStartDate?: string;

  @IsString()
  @IsOptional()
  message?: string;

  @IsString()
  @IsOptional()
  applicantPreferredSubdomain?: string;

  @IsString()
  @IsOptional()
  applicantPreferredDomain?: string;
}

export class ListApplicationsQueryDto {
  @IsString()
  @IsOptional()
  onboardingStage?: string;

  @IsString()
  @IsOptional()
  status?: string;

  @IsString()
  @IsOptional()
  applicantId?: string;
}

export class ReviewApplicationDto {
  @IsEnum(REVIEW_ACTIONS)
  @IsNotEmpty()
  action: ReviewAction;

  @IsString()
  @IsOptional()
  notes?: string;

  @IsString()
  @IsOptional()
  rejectionReason?: string;

  @IsString()
  @IsOptional()
  confirmedSubdomain?: string;

  @IsString()
  @IsOptional()
  confirmedDomain?: string;

  @IsString()
  @IsOptional()
  canonicalRoleKey?: string;
}

export class ConfirmTierSelectionDto {
  @IsEnum(ONBOARDING_TIER_CODES)
  @IsNotEmpty()
  tierCode: OnboardingTierCode;

  @IsEnum(ONBOARDING_BILLING_CYCLES)
  @IsOptional()
  billingCycle?: OnboardingBillingCycle;

  @Type(() => Boolean)
  @IsBoolean()
  @IsOptional()
  requestWhiteLabel?: boolean;
}

export class CreateApplicationPaymentIntentDto {
  @IsString()
  @IsOptional()
  idempotencyKey?: string;

  @IsString()
  @IsOptional()
  correlationId?: string;

  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(120)
  @IsOptional()
  ttlMinutes?: number;
}

export class SyncApplicationPaymentDto {
  @IsString()
  @IsOptional()
  paymentIntentId?: string;

  @IsString()
  @IsOptional()
  status?: string;

  @IsString()
  @IsOptional()
  providerReference?: string;

  @IsString()
  @IsOptional()
  note?: string;

  @Type(() => Boolean)
  @IsBoolean()
  @IsOptional()
  markSettled?: boolean;
}

export class AcceptEnterpriseQuoteDto {
  @IsString()
  @IsNotEmpty()
  quoteReference: string;

  @IsString()
  @IsOptional()
  note?: string;
}

export class ActivateApplicationDto {
  @IsString()
  @IsOptional()
  canonicalRoleKey?: string;

  @IsString()
  @IsOptional()
  confirmedSubdomain?: string;

  @IsString()
  @IsOptional()
  confirmedDomain?: string;
}
