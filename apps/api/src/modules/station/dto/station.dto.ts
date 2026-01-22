import { IsString, IsNotEmpty, IsOptional, IsEnum, IsNumber, IsLatitude, IsLongitude } from 'class-validator';

export class CreateStationDto {
    @IsString()
    @IsNotEmpty()
    code: string;

    @IsString()
    @IsNotEmpty()
    name: string;

    @IsString()
    @IsNotEmpty()
    address: string;

    @IsString()
    @IsNotEmpty()
    siteId: string;

    @IsLatitude()
    latitude: number;

    @IsLongitude()
    longitude: number;

    @IsEnum(['CHARGING', 'SWAP', 'BOTH'])
    @IsOptional()
    type?: 'CHARGING' | 'SWAP' | 'BOTH';

    @IsString()
    @IsOptional()
    orgId?: string;
}

export class UpdateStationDto {
    @IsString()
    @IsOptional()
    name?: string;

    @IsString()
    @IsOptional()
    address?: string;

    @IsEnum(['ACTIVE', 'INACTIVE', 'MAINTENANCE'])
    @IsOptional()
    status?: 'ACTIVE' | 'INACTIVE' | 'MAINTENANCE';

    @IsString()
    @IsOptional()
    siteId?: string;
}

export class CreateChargePointDto {
    @IsString()
    @IsNotEmpty()
    ocppId: string;

    @IsString()
    @IsNotEmpty()
    stationId: string;

    @IsString()
    @IsOptional()
    model?: string;

    @IsString()
    @IsOptional()
    manufacturer?: string;
}

export class UpdateChargePointDto {
    @IsString()
    @IsOptional()
    model?: string;

    @IsString()
    @IsOptional()
    firmwareVersion?: string;
}
