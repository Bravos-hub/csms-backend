import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Booking,
  ChargePoint,
  ChargingReceiptTransaction,
  Prisma,
  Session,
  Station,
  User,
} from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import * as jwt from 'jsonwebtoken';
import { SignOptions } from 'jsonwebtoken';
import { PrismaService } from '../../prisma.service';
import { MailService } from '../mail/mail.service';
import { NotificationService } from '../notification/notification-service.service';
import {
  AttendantAssignmentRequestDto,
  AttendantBookingsQueryDto,
  AttendantLoginDto,
  AttendantNotificationsQueryDto,
  AttendantPasswordResetConfirmDto,
  AttendantPasswordResetRequestDto,
  AttendantPasswordResetVerifyDto,
  AttendantPortsQueryDto,
  AttendantRefreshDto,
  AttendantSessionMetricsQueryDto,
  AttendantSyncBatchDto,
  AttendantTransactionsQueryDto,
} from './dto/attendant.dto';

type FrontendRole = 'fixed' | 'mobile';
type AssignmentStatus = 'active' | 'off_shift';
type BookingScope = 'current' | 'history' | 'upcoming';
type BookingStatus =
  | 'upcoming'
  | 'current_ready'
  | 'current_charging'
  | 'completed'
  | 'cancelled'
  | 'no_show';
type JobStatus = 'new' | 'scheduled' | 'active' | 'completed';

interface RefreshTokenPayload extends jwt.JwtPayload {
  sub: string;
  type: 'refresh';
}

interface PasswordResetPayload extends jwt.JwtPayload {
  sub: string;
  identifier: string;
  purpose: 'attendant_password_reset';
}

@Injectable()
export class AttendantService {
  private readonly logger = new Logger(AttendantService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly notificationService: NotificationService,
    private readonly mailService: MailService,
  ) {}

  async login(dto: AttendantLoginDto) {
    const identifier = dto.emailOrPhone.trim();
    const normalizedIdentifier = this.normalizeIdentifier(identifier);
    const identifierHash = this.hashIdentifierForLog(normalizedIdentifier);

    const user = await this.findUserByIdentifier(identifier);
    if (!user?.passwordHash) {
      this.logger.warn(
        JSON.stringify({
          event: 'attendant_login_failed',
          reason: 'user_missing_or_no_password',
          identifierHash,
        }),
      );
      throw new UnauthorizedException('Invalid credentials');
    }

    const validPassword = await this.comparePasswordWithLegacySupport(
      dto.password,
      user.passwordHash,
    );
    if (!validPassword) {
      this.logger.warn(
        JSON.stringify({
          event: 'attendant_login_failed',
          reason: 'invalid_password',
          identifierHash,
          userId: user.id,
        }),
      );
      throw new UnauthorizedException('Invalid credentials');
    }

    const assignment = await this.findActiveAssignment(user.id);
    if (!assignment) {
      this.logger.log(
        JSON.stringify({
          event: 'attendant_login_unassigned',
          identifierHash,
          userId: user.id,
        }),
      );
      return {
        kind: 'unassigned' as const,
        identifier: normalizedIdentifier,
        message: 'No active station assignment found for this account.',
        suggestedAction: 'request_assignment' as const,
      };
    }

    const { token, refreshToken } = await this.issueTokens(user);
    const assignmentStatus = this.resolveAssignmentStatus(
      assignment.shiftStart,
      assignment.shiftEnd,
      assignment.timezone,
      assignment.statusOverride,
    );

    return {
      kind: 'assigned' as const,
      session: {
        token,
        refreshToken,
        role: this.toFrontendRole(assignment.roleMode),
        authenticatedAt: new Date().toISOString(),
        user: {
          id: user.id,
          name: user.name,
          email: user.email || user.phone || `${user.id}@unknown.evzone`,
          role: this.toFrontendRole(assignment.roleMode),
        },
        station: {
          id: assignment.station.id,
          name: assignment.station.name,
          type: this.stationTypeLabel(assignment.station),
          location: assignment.station.address,
          tariff: this.stationTariffLabel(assignment.station),
        },
        assignmentStatus,
        shift: {
          startsAt: assignment.shiftStart,
          endsAt: assignment.shiftEnd,
          timezone: assignment.timezone,
          label: `${assignment.shiftStart} - ${assignment.shiftEnd}`,
        },
      },
    };
  }

  async refresh(dto: AttendantRefreshDto) {
    const secret = this.config.get<string>('JWT_SECRET');
    if (!secret) throw new Error('JWT_SECRET not configured');

    let payload: unknown;
    try {
      payload = jwt.verify(dto.refreshToken, secret);
    } catch {
      throw new UnauthorizedException('Invalid token');
    }
    if (!this.isRefreshTokenPayload(payload)) {
      throw new UnauthorizedException('Invalid token');
    }

    const storedToken = await this.prisma.refreshToken.findFirst({
      where: {
        token: dto.refreshToken,
        userId: payload.sub,
        expiresAt: { gt: new Date() },
        revokedAt: null,
      },
    });
    if (!storedToken) {
      throw new UnauthorizedException('Token not found, expired, or revoked');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
    });
    if (!user) throw new UnauthorizedException('User not found');

    return {
      token: this.signAccessToken(user),
      refreshToken: dto.refreshToken,
      authenticatedAt: new Date().toISOString(),
    };
  }

  async getSession(userId: string, accessToken: string) {
    const assignment = await this.requireAssignment(userId);
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });
    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    const assignmentStatus = this.resolveAssignmentStatus(
      assignment.shiftStart,
      assignment.shiftEnd,
      assignment.timezone,
      assignment.statusOverride,
    );

    return {
      token: accessToken,
      role: this.toFrontendRole(assignment.roleMode),
      authenticatedAt: new Date().toISOString(),
      user: {
        id: user.id,
        name: user.name,
        email: user.email || user.phone || `${user.id}@unknown.evzone`,
        role: this.toFrontendRole(assignment.roleMode),
      },
      station: {
        id: assignment.station.id,
        name: assignment.station.name,
        type: this.stationTypeLabel(assignment.station),
        location: assignment.station.address,
        tariff: this.stationTariffLabel(assignment.station),
      },
      assignmentStatus,
      shift: {
        startsAt: assignment.shiftStart,
        endsAt: assignment.shiftEnd,
        timezone: assignment.timezone,
        label: `${assignment.shiftStart} - ${assignment.shiftEnd}`,
      },
    };
  }

  async requestPasswordReset(dto: AttendantPasswordResetRequestDto) {
    const identifier = dto.emailOrPhone.trim();
    if (!identifier)
      throw new BadRequestException('Email or phone is required');

    const normalized = this.normalizeIdentifier(identifier);
    const channel = normalized.includes('@') ? 'email' : 'sms';
    const destinationMasked = this.maskIdentifier(normalized);
    const user = await this.findUserByIdentifier(normalized);

    if (user) {
      const code = this.generateOtpCode();
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
      await this.prisma.user.update({
        where: { id: user.id },
        data: { otpCode: code, otpExpiresAt: expiresAt },
      });

      try {
        if (channel === 'email' && user.email) {
          await this.mailService.sendMail(
            user.email,
            'EVzone Attendant Password Reset',
            `<p>Your verification code is <b>${code}</b>. It expires in 10 minutes.</p>`,
          );
        }
        if (channel === 'sms' && user.phone) {
          await this.notificationService.sendSms(
            user.phone,
            `EVzone: your password reset code is ${code}`,
          );
        }
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Password reset delivery failed: ${reason}`);
      }
    }

    return { channel, destinationMasked };
  }

  async verifyPasswordResetCode(dto: AttendantPasswordResetVerifyDto) {
    const normalized = this.normalizeIdentifier(dto.emailOrPhone);
    const user = await this.findUserByIdentifier(normalized);
    if (!user?.otpCode || user.otpCode !== dto.code.trim()) {
      throw new UnauthorizedException('Invalid verification code');
    }
    if (!user.otpExpiresAt || user.otpExpiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException('Verification code expired');
    }

    const secret = this.config.get<string>('JWT_SECRET');
    if (!secret) throw new Error('JWT_SECRET not configured');

    const verificationToken = jwt.sign(
      {
        sub: user.id,
        identifier: normalized,
        purpose: 'attendant_password_reset',
      },
      secret as jwt.Secret,
      { expiresIn: '10m' } as SignOptions,
    );

    return { verificationToken };
  }

  async confirmPasswordReset(dto: AttendantPasswordResetConfirmDto) {
    const normalized = this.normalizeIdentifier(dto.emailOrPhone);
    const user = await this.findUserByIdentifier(normalized);
    if (!user) throw new UnauthorizedException('Verification session expired');

    const secret = this.config.get<string>('JWT_SECRET');
    if (!secret) throw new Error('JWT_SECRET not configured');

    let payload: unknown;
    try {
      payload = jwt.verify(dto.verificationToken, secret);
    } catch {
      throw new UnauthorizedException('Verification session expired');
    }

    if (!this.isPasswordResetPayload(payload, user.id, normalized)) {
      throw new UnauthorizedException('Verification session expired');
    }
    if (!dto.newPassword || dto.newPassword.trim().length < 8) {
      throw new BadRequestException('Password must be at least 8 characters');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: await bcrypt.hash(dto.newPassword, 10),
        otpCode: null,
        otpExpiresAt: null,
      },
    });
  }

  async createAssignmentRequest(dto: AttendantAssignmentRequestDto) {
    const normalizedIdentifier = this.normalizeIdentifier(dto.identifier);
    const user = await this.findUserByIdentifier(normalizedIdentifier);
    const station = await this.prisma.station.findUnique({
      where: { id: dto.preferredStation },
      select: { id: true },
    });

    if (
      !this.isValidShiftTime(dto.preferredShiftStart) ||
      !this.isValidShiftTime(dto.preferredShiftEnd)
    ) {
      throw new BadRequestException('Shift time must be in HH:mm format');
    }
    if (dto.preferredShiftStart === dto.preferredShiftEnd) {
      throw new BadRequestException('Shift start and end cannot be the same');
    }

    const created = await this.prisma.attendantAssignmentRequest.create({
      data: {
        userId: user?.id,
        identifier: normalizedIdentifier,
        name: dto.name.trim(),
        orgId: dto.orgId.trim(),
        preferredStation: dto.preferredStation,
        preferredShiftStart: dto.preferredShiftStart,
        preferredShiftEnd: dto.preferredShiftEnd,
        notes: dto.notes?.trim(),
        status: 'pending',
        requestedAt: new Date(),
        stationId: station?.id,
      },
    });

    return {
      id: created.id,
      status: created.status,
      requestedAt: created.requestedAt.toISOString(),
    };
  }

  async listBookings(userId: string, query: AttendantBookingsQueryDto) {
    const assignment = await this.requireAssignment(userId);

    const rows = await this.prisma.booking.findMany({
      where: { stationId: assignment.stationId },
      include: { user: true, station: true },
      orderBy: { startTime: 'desc' },
    });

    const mapped = rows.map((row) => this.mapBooking(row));
    if (!query.scope) return mapped;
    return mapped.filter((row) =>
      this.belongsToScope(row.status, query.scope as BookingScope),
    );
  }

  async getBookingById(userId: string, bookingId: string) {
    const assignment = await this.requireAssignment(userId);
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: { user: true, station: true },
    });

    if (!booking) throw new NotFoundException('Booking not found');
    if (booking.stationId !== assignment.stationId) {
      throw new ForbiddenException(
        'Booking does not belong to your assignment',
      );
    }
    return this.mapBooking(booking);
  }

  async listPorts(userId: string, query: AttendantPortsQueryDto) {
    const assignment = await this.requireAssignment(userId);
    const requestedStationId = query.stationId || assignment.stationId;

    if (requestedStationId !== assignment.stationId) {
      throw new ForbiddenException('Cross-station access is not allowed');
    }

    const station = await this.prisma.station.findUnique({
      where: { id: requestedStationId },
      include: { chargePoints: true },
    });
    if (!station) return [];

    return station.chargePoints.map((port) => this.mapPort(port, station));
  }

  async getSessionMetrics(
    userId: string,
    query: AttendantSessionMetricsQueryDto,
  ) {
    const assignment = await this.requireAssignment(userId);

    if (query.state === 'pre_plug') {
      return {
        energyLabel: '0.0 kWh',
        rangeLabel: '0 km added',
        startedAt: 'Not started',
        remaining: '--:--:--',
        amount: 'UGX 0',
      };
    }

    const statusSet =
      query.state === 'charging'
        ? ['ACTIVE', 'CHARGING']
        : ['COMPLETED', 'STOPPED'];
    const latestSession = await this.prisma.session.findFirst({
      where: { stationId: assignment.stationId, status: { in: statusSet } },
      orderBy: { startTime: 'desc' },
    });
    return this.mapSessionMetrics(latestSession, query.state);
  }

  async getMobileAssignment(userId: string) {
    const assignment = await this.requireAssignment(userId);
    if (assignment.roleMode !== 'MOBILE') {
      throw new ForbiddenException('Mobile assignment required');
    }
    const station = await this.prisma.station.findUnique({
      where: { id: assignment.stationId },
      include: {
        chargePoints: true,
        jobs: { where: { status: { in: ['AVAILABLE', 'IN_PROGRESS'] } } },
      },
    });

    if (!station) throw new NotFoundException('Assigned station not found');

    const availablePorts = station.chargePoints.filter((cp) =>
      ['available', 'online'].includes(this.normalizeToken(cp.status)),
    ).length;
    const user = await this.prisma.user.findUnique({ where: { id: userId } });

    return {
      id: station.id,
      name: station.name,
      location: station.address,
      status: this.normalizeToken(station.status),
      capability: this.stationCapabilityLabel(station.type),
      shift: `${assignment.shiftStart} - ${assignment.shiftEnd}`,
      attendant: user?.name || 'Attendant',
      metrics: [
        {
          label: 'Chargers available',
          value: `${availablePorts} / ${station.chargePoints.length}`,
          tone: availablePorts > 0 ? 'ok' : 'warn',
        },
        {
          label: 'Jobs Pending',
          value: `${station.jobs.length}`,
          tone: station.jobs.length > 0 ? 'warn' : 'ok',
        },
      ],
    };
  }

  async listMobileJobs(userId: string) {
    const assignment = await this.requireAssignment(userId);
    if (assignment.roleMode !== 'MOBILE') {
      throw new ForbiddenException('Mobile assignment required');
    }
    const jobs = await this.prisma.job.findMany({
      where: {
        OR: [
          { technicianId: userId },
          {
            stationId: assignment.stationId,
            technicianId: null,
            status: 'AVAILABLE',
          },
        ],
      },
      include: { station: true },
      orderBy: { createdAt: 'desc' },
    });
    return jobs.map((job) => this.mapMobileJob(job));
  }

  async listTransactions(userId: string, query: AttendantTransactionsQueryDto) {
    const assignment = await this.requireAssignment(userId);
    const where: Prisma.ChargingReceiptTransactionWhereInput = {
      stationId: assignment.stationId,
    };

    if (query.source) where.source = query.source;
    if (query.paymentMethod) where.paymentMethod = query.paymentMethod;
    if (query.fromBooking !== undefined) where.fromBooking = query.fromBooking;

    const dateRange = this.resolveDateRange(query.dateRange);
    if (dateRange)
      where.createdAt = { gte: dateRange.start, lte: dateRange.end };

    const rows = await this.prisma.chargingReceiptTransaction.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((row) => this.mapReceiptTransaction(row));
  }

  async getTransactionById(userId: string, transactionId: string) {
    const assignment = await this.requireAssignment(userId);
    const row = await this.prisma.chargingReceiptTransaction.findUnique({
      where: { id: transactionId },
    });

    if (!row) throw new NotFoundException('Transaction not found');
    if (row.stationId !== assignment.stationId) {
      throw new ForbiddenException(
        'Transaction does not belong to your assignment',
      );
    }
    return this.mapReceiptTransaction(row);
  }

  async listNotifications(
    userId: string,
    query: AttendantNotificationsQueryDto,
  ) {
    const where: Prisma.AttendantNotificationWhereInput = { userId };
    if (query.unreadOnly === true) where.read = false;
    if (query.type) where.type = query.type;

    const rows = await this.prisma.attendantNotification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });

    return rows.map((row) => ({
      id: row.id,
      type: this.mapNotificationType(row.type),
      title: row.title,
      body: row.body,
      timestamp: this.relativeTimestamp(row.createdAt),
      severity: this.mapNotificationSeverity(row.severity),
      target: {
        type: this.mapNotificationTargetType(row.targetType),
        id: row.targetId,
        label: row.targetLabel,
      },
      read: row.read,
    }));
  }

  async markNotificationAsRead(userId: string, notificationId: string) {
    await this.prisma.attendantNotification.updateMany({
      where: { id: notificationId, userId },
      data: { read: true, readAt: new Date() },
    });
  }

  async markAllNotificationsAsRead(userId: string) {
    await this.prisma.attendantNotification.updateMany({
      where: { userId, read: false },
      data: { read: true, readAt: new Date() },
    });
  }

  async syncBatch(userId: string, dto: AttendantSyncBatchDto) {
    await this.requireAssignment(userId);
    const enabled = this.parseBoolean(
      this.config.get<string>('ATTENDANT_SYNC_ENABLED'),
    );
    if (!enabled) {
      throw new ServiceUnavailableException(
        'Attendant sync batch is disabled. This endpoint is Phase A scaffold only.',
      );
    }

    return {
      mode: 'scaffold',
      receivedAt: new Date().toISOString(),
      actions: dto.actions.map((action) => ({
        idempotencyKey: action.idempotencyKey,
        type: action.type,
        status: 'queued_stub',
      })),
    };
  }

  private async findUserByIdentifier(identifier: string) {
    const normalized = this.normalizeIdentifier(identifier);
    if (normalized.includes('@')) {
      return this.prisma.user.findFirst({
        where: { email: { equals: normalized, mode: 'insensitive' } },
      });
    }

    const users = await this.prisma.user.findMany({
      where: { phone: { not: null } },
    });
    const expectedPhone = this.normalizePhone(identifier);
    return (
      users.find(
        (user) => this.normalizePhone(user.phone || '') === expectedPhone,
      ) || null
    );
  }

  private async requireAssignment(userId: string) {
    if (!userId) throw new UnauthorizedException('Authentication required');

    const assignment = await this.findActiveAssignment(userId);
    if (!assignment)
      throw new ForbiddenException('No active attendant assignment found');
    return assignment;
  }

  private async findActiveAssignment(userId: string) {
    const now = new Date();
    return this.prisma.attendantAssignment.findFirst({
      where: {
        userId,
        isActive: true,
        OR: [{ activeFrom: null }, { activeFrom: { lte: now } }],
        AND: [{ OR: [{ activeTo: null }, { activeTo: { gte: now } }] }],
      },
      include: { station: true },
      orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
    });
  }

  private async issueTokens(user: User) {
    const token = this.signAccessToken(user);
    const refreshToken = this.signRefreshToken(user.id);

    const refreshExpiry = new Date();
    refreshExpiry.setDate(refreshExpiry.getDate() + 7);
    await this.prisma.refreshToken.create({
      data: { token: refreshToken, userId: user.id, expiresAt: refreshExpiry },
    });

    return { token, refreshToken };
  }

  private signAccessToken(user: User): string {
    const secret = this.config.get<string>('JWT_SECRET');
    if (!secret) throw new Error('JWT_SECRET not configured');

    return jwt.sign(
      { sub: user.id, email: user.email, role: user.role },
      secret as jwt.Secret,
      {
        expiresIn: this.config.get<string>('JWT_ACCESS_EXPIRY') || '15m',
      } as SignOptions,
    );
  }

  private signRefreshToken(userId: string): string {
    const secret = this.config.get<string>('JWT_SECRET');
    if (!secret) throw new Error('JWT_SECRET not configured');

    return jwt.sign(
      { sub: userId, type: 'refresh', jti: crypto.randomUUID() },
      secret as jwt.Secret,
      {
        expiresIn: this.config.get<string>('JWT_REFRESH_EXPIRY') || '7d',
      } as SignOptions,
    );
  }

  private resolveAssignmentStatus(
    shiftStart: string,
    shiftEnd: string,
    timezone: string,
    statusOverride?: string | null,
  ): AssignmentStatus {
    const normalizedOverride = this.normalizeToken(statusOverride);
    if (normalizedOverride === 'force_active') return 'active';
    if (normalizedOverride === 'force_off_shift') return 'off_shift';

    const nowMinutes = this.currentMinutesInTimezone(timezone);
    const startMinutes = this.toMinutes(shiftStart);
    const endMinutes = this.toMinutes(shiftEnd);
    const inShift =
      startMinutes <= endMinutes
        ? nowMinutes >= startMinutes && nowMinutes <= endMinutes
        : nowMinutes >= startMinutes || nowMinutes <= endMinutes;
    return inShift ? 'active' : 'off_shift';
  }

  private mapBooking(booking: Booking & { user: User; station: Station }) {
    const status = this.mapBookingStatus(booking);
    return {
      id: booking.id,
      vehicleModel: booking.vehicleModelSnapshot || 'Unknown EV',
      plate: booking.vehiclePlateSnapshot || '--',
      customerName:
        booking.customerNameSnapshot ||
        booking.user?.name ||
        'Unknown customer',
      customerRef:
        booking.customerRefSnapshot || booking.id.slice(0, 8).toUpperCase(),
      dateLabel: this.relativeDateLabel(booking.startTime),
      timeLabel: this.timeLabel(booking.startTime, booking.endTime),
      requiredKwh: booking.requiredKwh || 0,
      duration: this.durationLabel(booking.startTime, booking.endTime),
      fee: this.formatCurrency(
        booking.feeAmount || booking.station.bookingFee || 0,
      ),
      type: this.mapBookingType(booking.bookingType),
      status,
      autoCancelIn: this.autoCancelInLabel(booking.autoCancelAt, status),
      historyLabel: this.historyLabel(booking, status),
      highlight: false,
    };
  }

  private mapBookingStatus(booking: Booking): BookingStatus {
    const rawStatus = this.normalizeToken(booking.status);
    if (rawStatus === 'pending') {
      const now = Date.now();
      const start = booking.startTime.getTime();
      const end = booking.endTime.getTime();
      return now >= start && now <= end ? 'current_ready' : 'upcoming';
    }
    if (['confirmed', 'checked_in', 'ready'].includes(rawStatus))
      return 'current_ready';
    if (['active', 'charging', 'in_progress'].includes(rawStatus))
      return 'current_charging';
    if (['completed', 'stopped'].includes(rawStatus)) return 'completed';
    if (['cancelled', 'canceled', 'expired'].includes(rawStatus))
      return 'cancelled';
    if (['no_show', 'noshow'].includes(rawStatus)) return 'no_show';

    this.logger.warn(
      `Unknown booking status '${booking.status}', mapping to upcoming`,
    );
    return 'upcoming';
  }

  private mapBookingType(value: string): 'advance' | 'walk_in' {
    const normalized = this.normalizeToken(value);
    if (normalized === 'walk_in' || normalized === 'walkin') return 'walk_in';
    if (!normalized || normalized === 'advance') return 'advance';
    this.logger.warn(`Unknown booking type '${value}', mapping to advance`);
    return 'advance';
  }

  private belongsToScope(status: BookingStatus, scope: BookingScope): boolean {
    if (scope === 'upcoming') return status === 'upcoming';
    if (scope === 'current')
      return status === 'current_ready' || status === 'current_charging';
    return (
      status === 'completed' || status === 'cancelled' || status === 'no_show'
    );
  }

  private historyLabel(
    booking: Booking,
    status: BookingStatus,
  ): string | undefined {
    if (booking.historyLabel) return booking.historyLabel;
    if (status === 'completed') return 'Completed';
    if (status === 'cancelled') return 'Cancelled';
    if (status === 'no_show') return 'No show - Auto-cancelled';
    return undefined;
  }

  private mapPort(port: ChargePoint, station: Station) {
    return {
      id: port.id,
      connector: port.type || 'CCS2',
      maxPower: `${port.power} kW`,
      costModel: this.stationTariffLabel(station),
      status: this.mapPortStatus(port.status),
      lastUpdate: this.relativeTimestamp(port.updatedAt),
      unsyncedAction: false,
    };
  }

  private mapPortStatus(
    status: string,
  ): 'available' | 'in_use' | 'fault' | 'full' {
    const normalized = this.normalizeToken(status);
    if (['available', 'online', 'idle'].includes(normalized))
      return 'available';
    if (['charging', 'occupied', 'busy', 'in_use'].includes(normalized))
      return 'in_use';
    if (['finished', 'full'].includes(normalized)) return 'full';
    this.logger.warn(`Unknown port status '${status}', mapping to fault`);
    return 'fault';
  }

  private mapSessionMetrics(
    session: Session | null,
    state: 'pre_plug' | 'charging' | 'completed',
  ) {
    if (!session) {
      return {
        energyLabel: '0.0 kWh',
        rangeLabel: '0 km added',
        startedAt: 'Not started',
        remaining: '--:--:--',
        amount: 'UGX 0',
      };
    }

    const energy = Number.isFinite(session.totalEnergy)
      ? session.totalEnergy
      : 0;
    return {
      energyLabel: `${energy.toFixed(1)} kWh`,
      rangeLabel: `+${Math.max(0, Math.round(energy * 5))} km`,
      startedAt: session.startTime.toLocaleTimeString('en-UG', {
        hour: '2-digit',
        minute: '2-digit',
      }),
      remaining: state === 'completed' ? '00:00:00' : '--:--:--',
      amount: this.formatCurrency(session.amount || 0),
    };
  }

  private mapMobileJob(job: {
    id: string;
    title: string;
    status: string;
    description: string | null;
    station: Station;
  }) {
    return {
      id: job.id,
      status: this.mapMobileJobStatus(job.status),
      customerName: job.title || 'Customer',
      area: job.station.address || job.station.name,
      requestedKwh: 20,
      timeWindow: 'Today',
      distanceKm: 0,
      vehicleModel: 'EV',
      plate: '--',
      notes: job.description || '',
      phone: '+256 *** ***',
    };
  }

  private mapReceiptTransaction(row: ChargingReceiptTransaction) {
    return {
      id: row.id,
      sessionId: row.sessionId,
      bookingRef: row.bookingRef || 'WALK-IN',
      fromBooking: Boolean(row.fromBooking),
      stationId: row.stationId,
      stationName: row.stationName,
      locationText: row.locationText || 'Unknown location',
      operator: row.operator || 'Attendant',
      vehicleModel: row.vehicleModel || 'Unknown EV',
      plate: row.plate || '--',
      customerName: row.customerName || 'Unknown customer',
      connector: row.connector || 'Unknown connector',
      kwh: row.kwh || 0,
      duration: row.duration || '--:--:--',
      rate: row.rate || 0,
      taxes: row.taxes || 0,
      energyCost: row.energyCost || 0,
      total: row.total || 0,
      startedAt: row.startedAt
        ? new Date(row.startedAt).toISOString()
        : undefined,
      paymentMethod: this.mapPaymentMethod(row.paymentMethod),
      source: this.mapTransactionSource(row.source),
    };
  }

  private mapPaymentMethod(paymentMethod: string): 'EVzone Pay' | 'Cash' {
    return this.normalizeToken(paymentMethod) === 'cash'
      ? 'Cash'
      : 'EVzone Pay';
  }

  private mapTransactionSource(source: string): 'station' | 'mobile' {
    return this.normalizeToken(source) === 'mobile' ? 'mobile' : 'station';
  }

  private mapNotificationType(
    type: string,
  ): 'booking' | 'session' | 'hardware' | 'mobile' | 'sync' {
    const normalized = this.normalizeToken(type);
    if (
      ['booking', 'session', 'hardware', 'mobile', 'sync'].includes(normalized)
    ) {
      return normalized as
        | 'booking'
        | 'session'
        | 'hardware'
        | 'mobile'
        | 'sync';
    }
    this.logger.warn(`Unknown notification type '${type}', mapping to sync`);
    return 'sync';
  }

  private mapNotificationSeverity(
    severity: string,
  ): 'info' | 'warning' | 'critical' {
    const normalized = this.normalizeToken(severity);
    if (normalized === 'critical') return 'critical';
    if (normalized === 'warning' || normalized === 'warn') return 'warning';
    if (normalized !== 'info') {
      this.logger.warn(
        `Unknown notification severity '${severity}', mapping to info`,
      );
    }
    return 'info';
  }

  private mapNotificationTargetType(
    targetType: string,
  ): 'booking' | 'session' | 'transaction' | 'queue' | 'ports' {
    const normalized = this.normalizeToken(targetType);
    if (
      ['booking', 'session', 'transaction', 'queue', 'ports'].includes(
        normalized,
      )
    ) {
      return normalized as
        | 'booking'
        | 'session'
        | 'transaction'
        | 'queue'
        | 'ports';
    }
    this.logger.warn(
      `Unknown notification target '${targetType}', mapping to ports`,
    );
    return 'ports';
  }

  private resolveDateRange(raw?: string): { start: Date; end: Date } | null {
    if (!raw) return null;
    const normalized = this.normalizeToken(raw);
    const end = new Date();
    if (normalized === 'today') {
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      return { start, end };
    }
    if (normalized === '7d')
      return { start: new Date(Date.now() - 7 * 86400000), end };
    if (normalized === '30d')
      return { start: new Date(Date.now() - 30 * 86400000), end };

    const [from, to] = raw.split(':').map((v) => v.trim());
    if (!from || !to) return null;
    const start = new Date(from);
    const parsedEnd = new Date(to);
    if (Number.isNaN(start.getTime()) || Number.isNaN(parsedEnd.getTime()))
      return null;
    return { start, end: parsedEnd };
  }

  private stationTypeLabel(station: Station) {
    return station.type === 'SWAPPING' ? 'Swapping' : 'Charging';
  }

  private stationCapabilityLabel(type: Station['type']) {
    return type === 'SWAPPING' ? 'Swap' : 'Charge';
  }

  private stationTariffLabel(station: Station) {
    return `UGX ${Math.round(station.price || 0).toLocaleString('en-UG')} / kWh`;
  }

  private toFrontendRole(roleMode: string): FrontendRole {
    return roleMode === 'MOBILE' ? 'mobile' : 'fixed';
  }

  private currentMinutesInTimezone(timezone: string): number {
    const formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone || 'Africa/Kampala',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    const [hourText = '0', minuteText = '0'] = formatter
      .format(new Date())
      .split(':');
    return Number.parseInt(hourText, 10) * 60 + Number.parseInt(minuteText, 10);
  }

  private toMinutes(value: string): number {
    const [hour = '0', minute = '0'] = value.split(':');
    return Number.parseInt(hour, 10) * 60 + Number.parseInt(minute, 10);
  }

  private normalizeIdentifier(value: string): string {
    return value.trim().toLowerCase();
  }

  private normalizeLegacyBcryptPrefix(hash: string): string {
    if (hash.startsWith('$2y$') || hash.startsWith('$2x$')) {
      return `$2b$${hash.slice(4)}`;
    }
    return hash;
  }

  private isLikelyBcryptHash(hash: string): boolean {
    return (
      hash.startsWith('$2a$') ||
      hash.startsWith('$2b$') ||
      hash.startsWith('$2y$') ||
      hash.startsWith('$2x$')
    );
  }

  private constantTimeCompare(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
  }

  private async comparePasswordWithLegacySupport(
    candidatePassword: string,
    storedHash: string,
  ): Promise<boolean> {
    if (!storedHash) return false;

    if (this.isLikelyBcryptHash(storedHash)) {
      const normalizedHash = this.normalizeLegacyBcryptPrefix(storedHash);
      return bcrypt.compare(candidatePassword, normalizedHash);
    }

    if (storedHash.startsWith('$argon2')) {
      this.logger.error(
        'Unsupported attendant password hash format detected ($argon2). Migrate affected users to bcrypt hashes.',
      );
      return false;
    }

    return this.constantTimeCompare(candidatePassword, storedHash);
  }

  private hashIdentifierForLog(value: string): string {
    return crypto
      .createHash('sha256')
      .update(this.normalizeIdentifier(value))
      .digest('hex')
      .slice(0, 16);
  }

  private normalizePhone(value: string): string {
    return value.replace(/\D/g, '');
  }

  private maskIdentifier(identifier: string): string {
    if (identifier.includes('@')) {
      const [local = 'u', domain = 'evzone.africa'] = identifier.split('@');
      const maskedLocal =
        local.length <= 2 ? `${local[0] || 'u'}*` : `${local.slice(0, 2)}***`;
      return `${maskedLocal}@${domain}`;
    }
    const digits = identifier.replace(/\D/g, '');
    const lastFour = digits.slice(-4).padStart(4, '*');
    return `+*** *** ${lastFour}`;
  }

  private generateOtpCode() {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  private normalizeToken(value?: string | null): string {
    return (value || '').trim().toLowerCase().replace(/\s+/g, '_');
  }

  private parseBoolean(value?: string | null): boolean {
    const normalized = this.normalizeToken(value);
    return ['1', 'true', 'yes', 'on'].includes(normalized);
  }

  private mapMobileJobStatus(status: string): JobStatus {
    const normalized = this.normalizeToken(status);
    if (normalized === 'accepted') return 'scheduled';
    if (normalized === 'in_progress') return 'active';
    if (normalized === 'completed') return 'completed';
    if (normalized === 'cancelled' || normalized === 'canceled')
      return 'completed';
    return 'new';
  }

  private isValidShiftTime(value: string): boolean {
    return /^\d{2}:\d{2}$/.test(value);
  }

  private isRefreshTokenPayload(
    payload: unknown,
  ): payload is RefreshTokenPayload {
    if (!payload || typeof payload !== 'object') return false;
    const candidate = payload as Record<string, unknown>;
    return candidate.type === 'refresh' && typeof candidate.sub === 'string';
  }

  private isPasswordResetPayload(
    payload: unknown,
    userId: string,
    identifier: string,
  ): payload is PasswordResetPayload {
    if (!payload || typeof payload !== 'object') return false;
    const candidate = payload as Record<string, unknown>;
    return (
      candidate.purpose === 'attendant_password_reset' &&
      candidate.sub === userId &&
      candidate.identifier === identifier
    );
  }

  private relativeDateLabel(date: Date): string {
    const now = new Date();
    const startOfToday = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
    );
    const startOfDate = new Date(
      date.getFullYear(),
      date.getMonth(),
      date.getDate(),
    );
    const dayDiff = Math.round(
      (startOfDate.getTime() - startOfToday.getTime()) / (24 * 60 * 60 * 1000),
    );
    if (dayDiff === 0) return 'Today';
    if (dayDiff === -1) return 'Yesterday';
    if (dayDiff === 1) return 'Tomorrow';
    return date.toLocaleDateString('en-UG', { month: 'short', day: '2-digit' });
  }

  private timeLabel(start: Date, end: Date): string {
    const startLabel = start.toLocaleTimeString('en-UG', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    const endLabel = end.toLocaleTimeString('en-UG', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    return `Slot ${startLabel}-${endLabel}`;
  }

  private durationLabel(start: Date, end: Date): string {
    const minutes = Math.max(
      0,
      Math.round((end.getTime() - start.getTime()) / 60000),
    );
    return `${minutes} min`;
  }

  private autoCancelInLabel(
    autoCancelAt: Date | null,
    status: BookingStatus,
  ): string {
    if (!autoCancelAt || status !== 'current_ready') return '-';
    const remainingMs = autoCancelAt.getTime() - Date.now();
    if (remainingMs <= 0) return '00:00';
    const totalSeconds = Math.floor(remainingMs / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  private formatCurrency(amount: number): string {
    return `UGX ${Math.round(amount).toLocaleString('en-UG')}`;
  }

  private relativeTimestamp(date: Date): string {
    const diffMs = Date.now() - date.getTime();
    const diffMinutes = Math.floor(diffMs / 60000);
    if (diffMinutes <= 0) return 'Now';
    if (diffMinutes < 60) return `${diffMinutes} min ago`;
    const diffHours = Math.floor(diffMinutes / 60);
    if (diffHours < 24) return `${diffHours} h ago`;
    return `${Math.floor(diffHours / 24)} d ago`;
  }
}
