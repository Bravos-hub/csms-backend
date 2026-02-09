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

    @IsString()
    @IsOptional()
    ownerId?: string;

    // New Fields
    @IsNumber()
    @IsOptional()
    rating?: number;

    @IsNumber()
    @IsOptional()
    price?: number;

    @IsString()
    @IsOptional()
    amenities?: string; // JSON string

    @IsString()
    @IsOptional()
    images?: string; // JSON string

    @IsOptional()
    open247?: boolean;
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

    @IsString()
    @IsOptional()
    orgId?: string;

    @IsString()
    @IsOptional()
    ownerId?: string;

    @IsNumber()
    @IsOptional()
    rating?: number;

    @IsNumber()
    @IsOptional()
    price?: number;

    @IsString()
    @IsOptional()
    amenities?: string;

    @IsString()
    @IsOptional()
    images?: string;

    @IsOptional()
    open247?: boolean;
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

    @IsString()
    @IsOptional()
    type?: string;

    @IsNumber()
    @IsOptional()
    power?: number;
}

export class UpdateChargePointDto {
    @IsString()
    @IsOptional()
    model?: string;

    @IsString()
    @IsOptional()
    firmwareVersion?: string;

    @IsString()
    @IsOptional()
    type?: string;

    @IsNumber()
    @IsOptional()
    power?: number;
}
