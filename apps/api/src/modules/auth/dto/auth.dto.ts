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
    email: string;

    @IsString()
    role: Role;
}
