import { IsString, IsNumber, IsBoolean, IsOptional, IsEnum, IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class CreatePlanFeatureDto {
    @ApiProperty()
    @IsString()
    name: string;

    @ApiProperty({ required: false })
    @IsOptional()
    @IsString()
    category?: string;

    @ApiProperty({ required: false })
    @IsOptional()
    @IsNumber()
    order?: number;
}

export class CreatePlanPermissionDto {
    @ApiProperty()
    @IsString()
    resource: string;

    @ApiProperty()
    @IsString()
    action: string;

    @ApiProperty({ required: false })
    @IsOptional()
    @IsString()
    scope?: string;

    @ApiProperty({ required: false })
    @IsOptional()
    @IsNumber()
    limit?: number;
}

export class CreateSubscriptionPlanDto {
    @ApiProperty()
    @IsString()
    code: string;

    @ApiProperty()
    @IsString()
    name: string;

    @ApiProperty()
    @IsString()
    description: string;

    @ApiProperty()
    @IsString()
    role: string;

    @ApiProperty()
    @IsNumber()
    price: number;

    @ApiProperty()
    @IsString()
    currency: string;

    @ApiProperty()
    @IsEnum(['MONTHLY', 'YEARLY'])
    billingCycle: 'MONTHLY' | 'YEARLY';

    @ApiProperty({ required: false, default: true })
    @IsOptional()
    @IsBoolean()
    isActive?: boolean;

    @ApiProperty({ required: false, default: true })
    @IsOptional()
    @IsBoolean()
    isPublic?: boolean;

    @ApiProperty({ required: false, default: false })
    @IsOptional()
    @IsBoolean()
    isPopular?: boolean;

    @ApiProperty({ required: false })
    @IsOptional()
    limits?: any;

    @ApiProperty({ type: [CreatePlanFeatureDto], required: false })
    @IsOptional()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => CreatePlanFeatureDto)
    features?: CreatePlanFeatureDto[];

    @ApiProperty({ type: [CreatePlanPermissionDto], required: false })
    @IsOptional()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => CreatePlanPermissionDto)
    permissions?: CreatePlanPermissionDto[];
}
