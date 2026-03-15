import {
  ArrayMinSize,
  IsString,
  IsNotEmpty,
  IsEmail,
  MinLength,
  IsOptional,
  IsEnum,
  IsArray,
  ValidateNested,
  IsBoolean,
} from 'class-validator';
import { Type } from 'class-transformer';
import type { Role } from '@app/domain';
import { AttendantRoleMode, PayoutMethod } from '@prisma/client';

export class LoginDto {
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @IsString()
  @IsNotEmpty()
  password: string;

  @IsString()
  @IsOptional()
  inviteToken?: string;
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
  zoneId?: string;

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
  taxId?: string;

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

  @IsString()
  @IsOptional()
  country?: string;

  @IsString()
  @IsOptional()
  role?: Role;

  @IsString()
  @IsOptional()
  ownerCapability?: 'CHARGE' | 'SWAP' | 'BOTH';

  @IsString()
  @IsOptional()
  customRoleId?: string;

  @IsString()
  @IsOptional()
  customRoleName?: string;

  @IsEnum(['Active', 'Pending', 'Suspended', 'Inactive', 'Invited'])
  @IsOptional()
  status?: 'Active' | 'Pending' | 'Suspended' | 'Inactive' | 'Invited';
}

export class TeamStationAssignmentDto {
  @IsString()
  @IsNotEmpty()
  stationId: string;

  @IsString()
  @IsNotEmpty()
  role: Role;

  @IsBoolean()
  @IsOptional()
  isPrimary?: boolean;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @IsEnum(AttendantRoleMode)
  @IsOptional()
  attendantMode?: AttendantRoleMode;

  @IsString()
  @IsOptional()
  shiftStart?: string;

  @IsString()
  @IsOptional()
  shiftEnd?: string;

  @IsString()
  @IsOptional()
  timezone?: string;
}

export class TeamStationAssignmentsUpdateDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => TeamStationAssignmentDto)
  assignments: TeamStationAssignmentDto[];
}

export class TeamInviteUserDto {
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @IsString()
  @IsNotEmpty()
  role: Role;

  @IsString()
  @IsOptional()
  ownerCapability?: string;

  @IsString()
  @IsOptional()
  customRoleId?: string;

  @IsString()
  @IsOptional()
  customRoleName?: string;

  @IsString()
  @IsOptional()
  frontendUrl?: string;

  @IsString()
  @IsOptional()
  region?: string;

  @IsString()
  @IsOptional()
  zoneId?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TeamStationAssignmentDto)
  @IsOptional()
  initialAssignments?: TeamStationAssignmentDto[];
}

export class StaffPayoutProfileDto {
  @IsEnum(PayoutMethod)
  method: PayoutMethod;

  @IsString()
  @IsNotEmpty()
  beneficiaryName: string;

  @IsString()
  @IsOptional()
  providerName?: string;

  @IsString()
  @IsOptional()
  bankName?: string;

  @IsString()
  @IsOptional()
  accountNumber?: string;

  @IsString()
  @IsOptional()
  phoneNumber?: string;

  @IsString()
  @IsOptional()
  currency?: string;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}

export class StationContextSwitchDto {
  @IsString()
  @IsNotEmpty()
  assignmentId: string;
}

export class InviteUserDto {
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @IsString()
  @IsNotEmpty()
  role: Role;

  @IsString()
  @IsOptional()
  ownerCapability?: string;

  @IsString()
  @IsOptional()
  customRoleId?: string;

  @IsString()
  @IsOptional()
  customRoleName?: string;

  @IsString()
  @IsOptional()
  frontendUrl?: string;

  @IsString()
  @IsOptional()
  region?: string;

  @IsString()
  @IsOptional()
  zoneId?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TeamStationAssignmentDto)
  @IsOptional()
  initialAssignments?: TeamStationAssignmentDto[];
}

export class SwitchOrganizationDto {
  @IsString()
  @IsNotEmpty()
  organizationId: string;
}

export class AcceptInvitationResponseDto {
  email: string;
  organizationName: string;
  role: string;
  requiresTempPassword: boolean;
  inviteToken: string;
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
