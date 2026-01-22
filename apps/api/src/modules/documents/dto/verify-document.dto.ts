import { IsEnum, IsOptional, IsString } from 'class-validator';

export enum DocumentStatus {
    PENDING = 'PENDING',
    VERIFIED = 'VERIFIED',
    REJECTED = 'REJECTED',
    EXPIRED = 'EXPIRED',
    INFO_REQUESTED = 'INFO_REQUESTED',
}

export class VerifyDocumentDto {
    @IsEnum(DocumentStatus)
    status: DocumentStatus;

    @IsOptional()
    @IsString()
    notes?: string;

    @IsOptional()
    @IsString()
    rejectionReason?: string;
}
