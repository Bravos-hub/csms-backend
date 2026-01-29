import { IsString, IsNotEmpty, IsEmail, MinLength, IsOptional, IsEnum } from 'class-validator';
import type { Role } from '@app/domain';

export class LoginDto {
    @IsEmail()
    @IsNotEmpty()
    email: string;

    @IsString()
    @IsNotEmpty()
    password: string;
}

export class RefreshTokenDto {
    @IsString()
    @IsNotEmpty()
    refreshToken: string;
}

export class CreateUserDto {
    @IsEmail()
    @IsNotEmpty()
    email: string;

    @IsString()
    @IsNotEmpty()
    name: string;

    @IsString()
    @IsOptional()
    role?: Role;

    @IsString()
    @IsOptional()
    phone?: string;

    @IsString()
    @IsNotEmpty()
    @MinLength(8)
    password: string;

    @IsString()
    @IsOptional()
    organizationId?: string;

    @IsString()
    @IsOptional()
    country?: string;

    @IsString()
    @IsOptional()
    region?: string;

    @IsString()
    @IsOptional()
    subscribedPackage?: string;

    @IsString()
    @IsOptional()
    accountType?: 'COMPANY' | 'INDIVIDUAL';

    @IsString()
    @IsOptional()
    companyName?: string;

    @IsString()
    @IsOptional()
    ownerCapability?: 'CHARGE' | 'SWAP' | 'BOTH';
}

export class UpdateUserDto {
    @IsString()
    @IsOptional()
    name?: string;

    @IsString()
    @IsOptional()
    phone?: string;

    @IsEnum(['Active', 'Pending', 'Suspended', 'Inactive', 'Invited'])
    @IsOptional()
    status?: 'Active' | 'Pending' | 'Suspended' | 'Inactive' | 'Invited';
}

export class InviteUserDto {
    @IsEmail()
    @IsNotEmpty()
    email: string;

    @IsString()
    @IsNotEmpty()
    role: Role;
}

export class ServiceTokenRequestDto {
    @IsString()
    @IsOptional()
    clientId?: string;

    @IsString()
    @IsOptional()
    clientSecret?: string;

    @IsString()
    @IsOptional()
    scope?: string; // space-delimited, OAuth-style
}
