import { IsString, IsNotEmpty, IsOptional, IsEnum, IsNumber, IsDateString } from 'class-validator';

export class StopSessionDto {
    @IsString()
    @IsOptional()
    reason?: string;
}

export class SessionFilterDto {
    @IsString()
    @IsOptional()
    stationId?: string;

    @IsString()
    @IsOptional()
    userId?: string;

    @IsEnum(['ACTIVE', 'COMPLETED', 'STOPPED', 'INVALID'])
    @IsOptional()
    status?: string;
}
