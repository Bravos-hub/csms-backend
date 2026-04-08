import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsEnum,
  IsNumber,
  IsDateString,
} from 'class-validator';

export class CreateBookingDto {
  @IsOptional()
  @IsString()
  userId?: string;

  @IsOptional()
  @IsString()
  stationId?: string;

  @IsString()
  @IsNotEmpty()
  chargePointId: string;

  @IsNumber()
  @IsNotEmpty()
  connectorId: number;

  @IsDateString()
  @IsNotEmpty()
  startAt: string;

  @IsNumber()
  @IsOptional()
  durationMinutes?: number; // expiry = start + duration

  @IsOptional()
  @IsString()
  customerNameSnapshot?: string;

  @IsOptional()
  @IsString()
  customerRefSnapshot?: string;

  @IsOptional()
  @IsString()
  vehicleModelSnapshot?: string;

  @IsOptional()
  @IsString()
  vehiclePlateSnapshot?: string;

  @IsOptional()
  @IsNumber()
  requiredKwh?: number;

  @IsOptional()
  @IsNumber()
  feeAmount?: number;

  @IsOptional()
  @IsString()
  feeCurrency?: string;
}

export class UpdateBookingDto {
  @IsEnum(['PENDING', 'CONFIRMED', 'CANCELLED', 'NO_SHOW', 'EXPIRED'])
  @IsOptional()
  status?: 'PENDING' | 'CONFIRMED' | 'CANCELLED' | 'NO_SHOW' | 'EXPIRED';

  @IsOptional()
  @IsDateString()
  startAt?: string;

  @IsOptional()
  @IsNumber()
  durationMinutes?: number;

  @IsOptional()
  @IsString()
  reason?: string;
}

export class BookingActionDto {
  @IsOptional()
  @IsString()
  reason?: string;
}
