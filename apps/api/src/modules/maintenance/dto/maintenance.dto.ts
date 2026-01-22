import { IsString, IsNotEmpty, IsOptional, IsEnum, IsArray, IsUrl } from 'class-validator';

export class CreateIncidentDto {
    @IsString()
    @IsNotEmpty()
    stationId: string;

    @IsString()
    @IsNotEmpty()
    title: string;

    @IsString()
    @IsNotEmpty()
    description: string;

    @IsEnum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'])
    @IsNotEmpty()
    severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

    @IsString()
    @IsOptional()
    chargePointId?: string;

    @IsString()
    @IsOptional()
    assignedTo?: string;
}

export class UpdateIncidentDto {
    @IsEnum(['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'])
    @IsOptional()
    status?: string;

    @IsString()
    @IsOptional()
    assignedTo?: string;
}

export class CreateDispatchDto {
    @IsString()
    @IsNotEmpty()
    incidentId: string;

    @IsString()
    @IsNotEmpty()
    technicianId: string;

    @IsOptional()
    scheduledAt?: string;

    @IsString()
    @IsOptional()
    notes?: string;
}

export class CreateWebhookDto {
    @IsUrl()
    @IsNotEmpty()
    url: string;

    @IsArray()
    @IsNotEmpty()
    events: string[];

    @IsString()
    @IsOptional()
    secret?: string;
}
