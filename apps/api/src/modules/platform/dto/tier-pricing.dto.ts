import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export const TIER_CODES = ['T1', 'T2', 'T3', 'T4'] as const;
export type TierCode = (typeof TIER_CODES)[number];

export const DEPLOYMENT_MODELS = ['SHARED_SCHEMA', 'DEDICATED_DB'] as const;
export type DeploymentModel = (typeof DEPLOYMENT_MODELS)[number];

export const ACCOUNT_TYPES = [
  'INDIVIDUAL',
  'COMPANY',
  'STATE',
  'ORGANIZATION',
] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export const CPO_TYPES = ['CHARGE', 'SWAP', 'HYBRID'] as const;
export type CpoServiceType = (typeof CPO_TYPES)[number];

export class CreateTierPricingDraftDto {
  @IsString()
  @IsOptional()
  tierLabel?: string;

  @IsIn(DEPLOYMENT_MODELS)
  @IsOptional()
  deploymentModel?: DeploymentModel;

  @IsArray()
  @IsIn(ACCOUNT_TYPES, { each: true })
  @IsOptional()
  accountTypes?: AccountType[];

  @IsString()
  @IsOptional()
  currency?: string;

  @IsBoolean()
  @IsOptional()
  isCustomPricing?: boolean;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @IsOptional()
  monthlyPrice?: number | null;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @IsOptional()
  annualPrice?: number | null;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @IsOptional()
  setupFee?: number | null;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @IsOptional()
  swapMonthlyAddon?: number | null;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @IsOptional()
  swapAnnualAddon?: number | null;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @IsOptional()
  swapSetupAddon?: number | null;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @IsOptional()
  hybridMonthlyAddon?: number | null;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @IsOptional()
  hybridAnnualAddon?: number | null;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @IsOptional()
  hybridSetupAddon?: number | null;

  @IsBoolean()
  @IsOptional()
  whiteLabelAvailable?: boolean;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @IsOptional()
  whiteLabelMonthlyAddon?: number | null;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @IsOptional()
  whiteLabelSetupFee?: number | null;

  @IsString()
  @IsOptional()
  notes?: string;
}

export class PublishTierPricingVersionDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version: number;
}
