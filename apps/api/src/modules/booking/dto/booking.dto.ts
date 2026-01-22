import { IsString, IsNotEmpty, IsOptional, IsEnum, IsNumber, IsDateString } from 'class-validator';

export class CreateBookingDto {
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
}

export class UpdateBookingDto {
    @IsEnum(['CANCELLED', 'EXTENDED']) // Simplified for now
    @IsOptional()
    action?: 'CANCEL' | 'EXTEND';
}
