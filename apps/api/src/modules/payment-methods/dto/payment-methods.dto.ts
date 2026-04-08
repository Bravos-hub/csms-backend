import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

const PAYMENT_METHOD_TYPES = [
  'CARD',
  'MOBILE_MONEY',
  'BANK_TRANSFER',
  'WALLET',
  'QR_HOSTED',
] as const;

const PAYMENT_METHOD_STATUSES = ['ACTIVE', 'INACTIVE', 'REVOKED'] as const;

export class PaymentMethodListQueryDto {
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  includeInactive?: boolean;
}

export class CreatePaymentMethodDto {
  @IsString()
  @IsNotEmpty()
  @IsIn(PAYMENT_METHOD_TYPES)
  type: (typeof PAYMENT_METHOD_TYPES)[number];

  @IsString()
  @IsNotEmpty()
  tokenRef: string;

  @IsOptional()
  @IsString()
  provider?: string;

  @IsOptional()
  @IsString()
  label?: string;

  @IsOptional()
  @IsString()
  last4?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  expiryMonth?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2024)
  @Max(2100)
  expiryYear?: number;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  setDefault?: boolean;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class UpdatePaymentMethodDto {
  @IsOptional()
  @IsString()
  @IsIn(PAYMENT_METHOD_STATUSES)
  status?: (typeof PAYMENT_METHOD_STATUSES)[number];

  @IsOptional()
  @IsString()
  label?: string;

  @IsOptional()
  @IsString()
  provider?: string;

  @IsOptional()
  @IsString()
  tokenRef?: string;

  @IsOptional()
  @IsString()
  last4?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  expiryMonth?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2024)
  @Max(2100)
  expiryYear?: number;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  setDefault?: boolean;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
