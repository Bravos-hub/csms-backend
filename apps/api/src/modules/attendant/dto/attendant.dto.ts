import { Transform, Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

export class AttendantLoginDto {
  @IsString()
  @IsNotEmpty()
  emailOrPhone: string;

  @IsString()
  @IsNotEmpty()
  password: string;
}

export class AttendantRefreshDto {
  @IsString()
  @IsNotEmpty()
  refreshToken: string;
}

export class AttendantPasswordResetRequestDto {
  @IsString()
  @IsNotEmpty()
  emailOrPhone: string;
}

export class AttendantPasswordResetVerifyDto {
  @IsString()
  @IsNotEmpty()
  emailOrPhone: string;

  @IsString()
  @IsNotEmpty()
  code: string;
}

export class AttendantPasswordResetConfirmDto {
  @IsString()
  @IsNotEmpty()
  emailOrPhone: string;

  @IsString()
  @IsNotEmpty()
  verificationToken: string;

  @IsString()
  @IsNotEmpty()
  newPassword: string;
}

export class AttendantAssignmentRequestDto {
  @IsString()
  @IsNotEmpty()
  identifier: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  orgId: string;

  @IsString()
  @IsNotEmpty()
  preferredStation: string;

  @IsString()
  @IsNotEmpty()
  preferredShiftStart: string;

  @IsString()
  @IsNotEmpty()
  preferredShiftEnd: string;

  @IsString()
  @IsOptional()
  notes?: string;
}

export class AttendantBookingsQueryDto {
  @IsOptional()
  @IsIn(['current', 'history', 'upcoming'])
  scope?: 'current' | 'history' | 'upcoming';
}

export class AttendantPortsQueryDto {
  @IsOptional()
  @IsString()
  stationId?: string;
}

export class AttendantSessionMetricsQueryDto {
  @IsIn(['pre_plug', 'charging', 'completed'])
  state: 'pre_plug' | 'charging' | 'completed';
}

export class AttendantTransactionsQueryDto {
  @IsOptional()
  @IsString()
  dateRange?: string;

  @IsOptional()
  @IsIn(['station', 'mobile'])
  source?: 'station' | 'mobile';

  @IsOptional()
  @IsIn(['EVzone Pay', 'Cash'])
  paymentMethod?: 'EVzone Pay' | 'Cash';

  @Transform(({ value }) => {
    if (value === undefined) return undefined;
    if (typeof value === 'boolean') return value;
    return String(value).toLowerCase() === 'true';
  })
  @IsOptional()
  @IsBoolean()
  fromBooking?: boolean;
}

export class AttendantNotificationsQueryDto {
  @Transform(({ value }) => {
    if (value === undefined) return undefined;
    if (typeof value === 'boolean') return value;
    return String(value).toLowerCase() === 'true';
  })
  @IsOptional()
  @IsBoolean()
  unreadOnly?: boolean;

  @IsOptional()
  @IsIn(['booking', 'session', 'hardware', 'mobile', 'sync'])
  type?: 'booking' | 'session' | 'hardware' | 'mobile' | 'sync';
}

export class AttendantSyncActionDto {
  @IsString()
  @IsNotEmpty()
  idempotencyKey: string;

  @IsString()
  @IsNotEmpty()
  type: string;

  @IsObject()
  payload: Record<string, unknown>;

  @IsOptional()
  @IsString()
  createdAt?: string;
}

export class AttendantSyncBatchDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => AttendantSyncActionDto)
  actions: AttendantSyncActionDto[];
}
