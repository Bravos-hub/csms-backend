import {
    IsInt,
    IsNotEmpty,
    IsOptional,
    IsString,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateSiteDocumentDto {
    @IsString()
    @IsNotEmpty()
    name: string;

    @IsString()
    @IsNotEmpty()
    type: string;

    @IsString()
    @IsNotEmpty()
    fileUrl: string;

    @Type(() => Number)
    @IsInt()
    @IsOptional()
    fileSize?: number;

    @IsString()
    @IsOptional()
    mimeType?: string;

    @IsString()
    @IsOptional()
    uploadedBy?: string;

    @IsString()
    @IsOptional()
    description?: string;
}

export class UpdateSiteDocumentDto {
    @IsString()
    @IsOptional()
    name?: string;

    @IsString()
    @IsOptional()
    type?: string;

    @IsString()
    @IsOptional()
    description?: string;
}
