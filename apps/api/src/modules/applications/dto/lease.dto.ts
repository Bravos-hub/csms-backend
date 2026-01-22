import { IsString, IsNotEmpty, IsOptional, IsEnum } from 'class-validator';

export enum LeaseStatus {
    DRAFT = 'DRAFT',
    PENDING_SIGNATURE = 'PENDING_SIGNATURE',
    SIGNED = 'SIGNED',
}

export class SignLeaseDto {
    @IsString()
    @IsNotEmpty()
    signedLeaseUrl: string;
}

export class RegisterLeaseDto {
    @IsString()
    @IsNotEmpty()
    registrationCertificateUrl: string;
}

export class VerifyLeaseDto {
    @IsString()
    @IsNotEmpty()
    @IsEnum(['VERIFIED', 'REJECTED'])
    status: 'VERIFIED' | 'REJECTED';

    @IsString()
    @IsOptional()
    notes?: string;
}
