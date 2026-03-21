import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsEnum,
  IsInt,
  IsArray,
  IsNumber,
  Min,
  Max,
} from 'class-validator';
import { PowertrainType, ConnectorType } from '@prisma/client';

export class CreateVehicleDto {
  @IsString()
  @IsNotEmpty()
  vehicleName: string;

  @IsString()
  @IsNotEmpty()
  make: string;

  @IsString()
  @IsNotEmpty()
  model: string;

  @IsInt()
  @Min(1980)
  @Max(new Date().getFullYear() + 1)
  yearOfManufacture: number;

  @IsString()
  @IsNotEmpty()
  licensePlate: string;

  @IsEnum(PowertrainType)
  powertrain: PowertrainType;

  @IsOptional()
  @IsString()
  countryOfRegistration?: string;

  @IsOptional()
  @IsString()
  vin?: string;

  @IsOptional()
  @IsString()
  photoUrl?: string;

  @IsOptional()
  @IsString()
  bodyType?: string;

  @IsOptional()
  @IsString()
  color?: string;

  @IsOptional()
  @IsNumber()
  batteryKwh?: number;

  @IsOptional()
  @IsNumber()
  acMaxKw?: number;

  @IsOptional()
  @IsNumber()
  dcMaxKw?: number;

  @IsOptional()
  @IsArray()
  @IsEnum(ConnectorType, { each: true })
  connectors?: ConnectorType[];
}

export class UpdateVehicleDto {
  @IsOptional()
  @IsString()
  vehicleName?: string;

  @IsOptional()
  @IsString()
  make?: string;

  @IsOptional()
  @IsString()
  model?: string;

  @IsOptional()
  @IsInt()
  @Min(1980)
  yearOfManufacture?: number;

  @IsOptional()
  @IsString()
  licensePlate?: string;

  @IsOptional()
  @IsEnum(PowertrainType)
  powertrain?: PowertrainType;

  @IsOptional()
  @IsString()
  countryOfRegistration?: string;

  @IsOptional()
  @IsString()
  vin?: string;

  @IsOptional()
  @IsString()
  photoUrl?: string;

  @IsOptional()
  @IsString()
  bodyType?: string;

  @IsOptional()
  @IsString()
  color?: string;

  @IsOptional()
  @IsNumber()
  batteryKwh?: number;

  @IsOptional()
  @IsNumber()
  acMaxKw?: number;

  @IsOptional()
  @IsNumber()
  dcMaxKw?: number;

  @IsOptional()
  @IsArray()
  @IsEnum(ConnectorType, { each: true })
  connectors?: ConnectorType[];
}

export class SetActiveVehicleDto {
  @IsOptional()
  @IsString()
  vehicleId: string | null;
}
