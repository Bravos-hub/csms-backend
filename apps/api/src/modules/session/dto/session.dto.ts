import { Type } from 'class-transformer';
import { IsString, IsOptional, IsEnum, IsInt, Min, Max } from 'class-validator';

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

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  limit?: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @IsOptional()
  offset?: number;
}
