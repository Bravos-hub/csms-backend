import { Type } from 'class-transformer';
import {
  IsNumber,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
  IsInt,
  Max,
  IsISO8601,
} from 'class-validator';

export class TopUpDto {
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  amount: number;

  @IsOptional()
  @IsString()
  paymentMethodId?: string;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsString()
  idempotencyKey?: string;

  @IsOptional()
  @IsString()
  correlationId?: string;

  @IsOptional()
  @IsString()
  note?: string;
}

export class GenerateInvoiceDto {
  @IsString()
  @IsNotEmpty()
  userId: string;

  @IsOptional()
  @IsISO8601()
  billingPeriodFrom?: string;

  @IsOptional()
  @IsISO8601()
  billingPeriodTo?: string;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(90)
  dueInDays?: number;

  @IsOptional()
  @IsString()
  correlationId?: string;
}

export class CreatePaymentMethodDto {
  @IsString()
  @IsNotEmpty()
  type: string; // card, bank_transfer

  @IsString()
  @IsNotEmpty()
  token: string; // stripe token etc
}
