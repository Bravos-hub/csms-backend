import { Injectable, UnauthorizedException, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { UserRole, StationOwnerCapability } from '@prisma/client';
import { LoginDto, CreateUserDto, UpdateUserDto, InviteUserDto } from './dto/auth.dto';
import { NotificationService } from '../notification/notification-service.service';
import { MailService } from '../mail/mail.service';
import { AdminApprovalService } from './admin-approval.service';
import { ConfigService } from '@nestjs/config';
import { MetricsService } from '../../common/services/metrics.service';
import { OcpiTokenSyncService } from '../../common/services/ocpi-token-sync.service';
import * as crypto from 'crypto';
import * as jwt from 'jsonwebtoken';
import { SignOptions } from 'jsonwebtoken';
import * as bcrypt from 'bcrypt';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationService: NotificationService,
    private readonly mailService: MailService,
    private readonly config: ConfigService,
    private readonly metrics: MetricsService,
    private readonly ocpiTokenSync: OcpiTokenSyncService,
    private readonly approvalService: AdminApprovalService,
  ) { }

  getHello(): string {
    return 'Auth Service Operational';
  }

  async login(loginDto: LoginDto) {
    const startTime = Date.now();
    try {
      this.logger.log(`Login attempt for ${loginDto.email}`);
      const user = await this.prisma.user.findUnique({ where: { email: loginDto.email } });
      if (!user) {
        throw new UnauthorizedException('Invalid credentials');
      }

      if (!user.passwordHash) {
        throw new UnauthorizedException('Invalid credentials');
      }

      const isPasswordValid = await bcrypt.compare(loginDto.password, user.passwordHash);
      if (!isPasswordValid) {
        throw new UnauthorizedException('Invalid credentials');
      }

      // Check for awaiting approval status if not handled by frontend
      if (user.status === 'AwaitingApproval') {
        this.logger.log(`User ${user.email} is awaiting approval`);
        // We still return the user/token so frontend can redirect, 
        // OR we can throw a specific error. 
        // For now, let's allow it but log it (frontend handles the redirect)
      }

      // Auto-activate Super Admin on successful login if not already active
      if (user.role === UserRole.SUPER_ADMIN && user.status !== 'Active') {
        this.logger.log(`Auto-activating Super Admin: ${user.email}`);
        await this.prisma.user.update({
          where: { id: user.id },
          data: { status: 'Active' }
        });
        user.status = 'Active';
      }

      return this.generateAuthResponse(user);
    } catch (error) {
      this.logger.error(`Login error for ${loginDto.email}: ${error.message}`, error.stack);
      throw error;
    }
  }

  private async generateAuthResponse(user: any) {
    const result = await this.issueTokens(user);

    this.metrics.recordAuthMetric({
      operation: 'login',
      success: true,
      duration: 0,
      userId: user.id,
      timestamp: new Date()
    });

    return result;
  }


  async register(createUserDto: any) {
    const exists = await this.prisma.user.findUnique({ where: { email: createUserDto.email } });
    if (exists) {
      if (exists.status === 'Pending') {
        const verificationToken = await this.generateEmailVerificationToken(exists.id);
        try {
          await this.mailService.sendVerificationEmail(createUserDto.email, verificationToken, createUserDto.frontendUrl);
        } catch (error) {
          this.logger.error('Failed to send verification email', String(error).replace(/[\n\r]/g, ''));
        }
        await this.syncOcpiTokenSafe(exists);
        return { success: true, message: 'Registration successful. Please check your email.' };
      }
      throw new BadRequestException('User already exists');
    }

    if (createUserDto.phone) {
      const phoneExists = await this.prisma.user.findUnique({ where: { phone: createUserDto.phone } });
      if (phoneExists) throw new BadRequestException('User with this phone number already exists');
    }

    const hashedPassword = await bcrypt.hash(createUserDto.password, 10);

    // Registration Transaction
    const result = await this.prisma.$transaction(async (tx) => {
      // 1. Create Organization
      const orgType = createUserDto.accountType || 'COMPANY';
      const orgName = orgType === 'COMPANY'
        ? (createUserDto.companyName || `${createUserDto.name}'s Corp`)
        : (createUserDto.companyName || createUserDto.name);

      const organization = await tx.organization.create({
        data: {
          name: orgName,
          type: orgType,
        }
      });

      // 2. Create User linked to Org
      const user = await tx.user.create({
        data: {
          email: createUserDto.email,
          name: createUserDto.name,
          phone: createUserDto.phone,
          role: (createUserDto.role as any) || 'SITE_OWNER',
          status: 'Pending', // User starts as Pending (email not verified)
          passwordHash: hashedPassword,
          country: createUserDto.country,
          region: createUserDto.region,
          subscribedPackage: createUserDto.subscribedPackage || 'Free',
          ownerCapability: createUserDto.ownerCapability as any,
          organizationId: organization.id,
        }
      });

      // 3. Create User Application for Admin Approval
      await tx.userApplication.create({
        data: {
          userId: user.id,
          companyName: createUserDto.companyName,
          taxId: createUserDto.taxId,
          country: createUserDto.country || 'Unknown',
          region: createUserDto.region || 'Unknown',
          accountType: orgType,
          role: createUserDto.role || 'SITE_OWNER',
          subscribedPackage: createUserDto.subscribedPackage,
          status: 'PENDING',
        }
      });

      return { user, organization };
    });

    await this.syncOcpiTokenSafe(result.user);

    try {
      const verificationToken = await this.generateEmailVerificationToken(result.user.id);
      await this.mailService.sendVerificationEmail(createUserDto.email, verificationToken, createUserDto.frontendUrl);
    } catch (error) {
      this.logger.error('Failed to send verification email', String(error).replace(/[\n\r]/g, ''));
    }

    return {
      success: true,
      message: 'Registration successful. Please check your email.',
      user: {
        id: result.user.id,
        email: result.user.email,
        organizationId: result.organization.id
      }
    };
  }

  async inviteUser(inviteDto: InviteUserDto) {
    const exists = await this.prisma.user.findUnique({ where: { email: inviteDto.email } });
    if (exists) throw new BadRequestException('User already exists');

    const passwordHash = inviteDto.password
      ? await bcrypt.hash(inviteDto.password, 10)
      : undefined;

    const user = await this.prisma.user.create({
      data: {
        email: inviteDto.email,
        name: inviteDto.email.split('@')[0],
        role: inviteDto.role as unknown as UserRole,
        status: inviteDto.password ? 'Active' : 'Invited',
        passwordHash,
        ownerCapability: inviteDto.ownerCapability as unknown as StationOwnerCapability,
      },
    });

    try {
      // Human-readable role name mapping (matching frontend labels roughly)
      const roleLabels: any = {
        'SUPER_ADMIN': 'Super Admin',
        'EVZONE_ADMIN': 'EVzone Admin',
        'EVZONE_OPERATOR': 'EVzone Operations',
        'STATION_OPERATOR': 'Station Operator',
        'SITE_OWNER': 'Site Owner',
        'STATION_ADMIN': 'Station Admin',
        'MANAGER': 'Manager',
        'ATTENDANT': 'Attendant',
        'CASHIER': 'Cashier',
        'STATION_OWNER': 'Station Owner',
      };

      const roleName = roleLabels[inviteDto.role] || inviteDto.role;
      await this.mailService.sendInvitationEmail(inviteDto.email, roleName, 'EV Zone', inviteDto.frontendUrl);
    } catch (error) {
      this.logger.error('Failed to send invitation email', String(error).replace(/[\n\r]/g, ''));
    }

    return { success: true, user };
  }

  async issueServiceToken(clientId: string, clientSecret: string, scope?: string) {
    const serviceAccount = await this.prisma.serviceAccount.findUnique({
      where: { clientId },
    });

    if (!serviceAccount || serviceAccount.status !== 'ACTIVE') {
      throw new UnauthorizedException('Invalid or inactive service account');
    }

    const isValid = this.verifyServiceSecret(
      clientSecret,
      serviceAccount.secretSalt,
      serviceAccount.secretHash,
    );

    if (!isValid) {
      throw new UnauthorizedException('Invalid service credentials');
    }

    const requestedScopes = this.normalizeScopes(scope);
    const allowedScopes = this.normalizeScopes(serviceAccount.scopes);

    const payload = {
      sub: serviceAccount.id,
      clientId: serviceAccount.clientId,
      scopes: requestedScopes.length > 0 ? requestedScopes : allowedScopes,
      type: 'SERVICE',
    };

    const token = jwt.sign(payload, this.config.get<string>('JWT_SERVICE_SECRET') || 'dev_secret', {
      expiresIn: (this.config.get('JWT_SERVICE_EXPIRY') as SignOptions['expiresIn']) || '1y',
      issuer: this.config.get('JWT_SERVICE_ISSUER'),
      audience: this.config.get('JWT_SERVICE_AUDIENCE'),
    });

    return {
      accessToken: token,
      expiresIn: this.config.get('JWT_SERVICE_EXPIRY') || '1y',
    };
  }

  async requestOtp(identifier: string) {
    const isEmail = identifier.includes('@');
    if (!identifier) throw new BadRequestException('Identifier required');

    let user = await this.prisma.user.findFirst({
      where: isEmail ? { email: identifier } : { phone: identifier }
    });

    if (!user) {
      if (isEmail) {
        throw new NotFoundException('User not found');
      }

      user = await this.prisma.user.create({
        data: { phone: identifier, name: 'Mobile User', status: 'Pending' }
      });

      await this.syncOcpiTokenSafe(user);
    }

    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expires = new Date(Date.now() + 5 * 60 * 1000);

    await this.prisma.user.update({
      where: { id: user.id },
      data: { otpCode: code, otpExpiresAt: expires }
    });

    if (isEmail) {
      await this.mailService.sendMail(user.email!, 'Verification OTP', `<p>Your OTP is <b>${code}</b></p>`);
    } else {
      await this.notificationService.sendSms(identifier, `EvZone: Your verification code is ${code}`);
    }

    return { status: 'OTP Sent', identifier };
  }

  async verifyOtp(identifier: string, code: string) {
    const isEmail = identifier.includes('@');
    const user = await this.prisma.user.findFirst({
      where: isEmail ? { email: identifier } : { phone: identifier }
    });
    if (!user) throw new UnauthorizedException('User not found');

    if (!user.otpCode || user.otpCode !== code) {
      throw new UnauthorizedException('Invalid OTP');
    }

    if (!user.otpExpiresAt || new Date() > user.otpExpiresAt) {
      throw new UnauthorizedException('OTP Expired');
    }

    const updatedUser = await this.prisma.user.update({
      where: { id: user.id },
      data: { status: 'Active', otpCode: null, otpExpiresAt: null }
    });

    await this.syncOcpiTokenSafe(updatedUser);

    return this.issueTokens(updatedUser as any);
  }

  async resetPassword(identifier: string, code: string, newPassword: string) {
    const isEmail = identifier.includes('@');
    const user = await this.prisma.user.findFirst({
      where: isEmail ? { email: identifier } : { phone: identifier }
    });
    if (!user) throw new UnauthorizedException('User not found');

    if (!user.otpCode || !this.constantTimeCompare(user.otpCode, code)) {
      throw new UnauthorizedException('Invalid OTP');
    }

    if (!user.otpExpiresAt || new Date() > user.otpExpiresAt) {
      throw new UnauthorizedException('OTP Expired');
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    const updatedUser = await this.prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: hashedPassword,
        otpCode: null,
        otpExpiresAt: null,
        status: 'Active'
      }
    });

    await this.syncOcpiTokenSafe(updatedUser);

    return { success: true, message: 'Password reset successful' };
  }

  private async issueTokens(user: any) {
    const secret = this.config.get<string>('JWT_SECRET');
    if (!secret) {
      throw new Error('JWT_SECRET not configured');
    }

    const accessToken = jwt.sign(
      { sub: user.id, email: user.email, role: user.role },
      secret as jwt.Secret,
      { expiresIn: (this.config.get<string>('JWT_ACCESS_EXPIRY') || '15m') as any } as SignOptions
    );

    const refreshToken = jwt.sign(
      { sub: user.id, type: 'refresh', jti: crypto.randomUUID() },
      secret as jwt.Secret,
      { expiresIn: this.config.get<string>('JWT_REFRESH_EXPIRY') || '7d' } as SignOptions
    );

    const refreshExpiry = new Date();
    refreshExpiry.setDate(refreshExpiry.getDate() + 7);

    await this.prisma.refreshToken.create({
      data: {
        token: refreshToken,
        userId: user.id,
        expiresAt: refreshExpiry,
      },
    });

    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        phone: user.phone,
        role: user.role,
        name: user.name,
        status: user.status,
        ownerCapability: user.ownerCapability,
        organizationId: user.organizationId
      }
    };
  }

  async refresh(refreshToken: string) {
    const startTime = Date.now();
    const secret = this.config.get<string>('JWT_SECRET');

    try {
      if (!secret) throw new Error('JWT_SECRET not configured');

      let payload: any;
      try {
        payload = jwt.verify(refreshToken, secret);
      } catch (error) {
        throw new UnauthorizedException('Invalid token');
      }

      const storedToken = await this.prisma.refreshToken.findFirst({
        where: {
          token: refreshToken,
          userId: payload.sub,
          expiresAt: { gt: new Date() },
          revokedAt: null,
        },
      });

      if (!storedToken) throw new UnauthorizedException('Token not found, expired, or revoked');

      const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
      if (!user) throw new UnauthorizedException('User not found');

      const accessToken = jwt.sign(
        { sub: user.id, email: user.email, role: user.role },
        secret as jwt.Secret,
        { expiresIn: this.config.get<string>('JWT_ACCESS_EXPIRY') || '15m' } as SignOptions
      );

      this.metrics.recordAuthMetric({
        operation: 'refresh',
        success: true,
        duration: Date.now() - startTime,
        userId: user.id,
        timestamp: new Date(),
      });

      return {
        accessToken,
        refreshToken,
        user: {
          id: user.id,
          email: user.email,
          phone: user.phone,
          role: user.role,
          name: user.name,
          status: user.status,
          ownerCapability: user.ownerCapability,
          organizationId: user.organizationId
        },
      };
    } catch (error) {
      this.metrics.recordAuthMetric({
        operation: 'refresh',
        success: false,
        duration: Date.now() - startTime,
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date(),
      });
      throw error;
    }
  }

  async revokeRefreshToken(token: string): Promise<void> {
    const startTime = Date.now();
    try {
      await this.prisma.refreshToken.updateMany({
        where: { token, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      this.metrics.recordAuthMetric({
        operation: 'logout',
        success: true,
        duration: Date.now() - startTime,
        timestamp: new Date(),
      });
    } catch (error) {
      this.metrics.recordAuthMetric({
        operation: 'logout',
        success: false,
        duration: Date.now() - startTime,
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date(),
      });
    }
  }

  async findAllUsers(params: { search?: string; role?: string } = {}) {
    const where: any = {};
    if (params.search) {
      where.OR = [
        { name: { contains: params.search, mode: 'insensitive' } },
        { email: { contains: params.search, mode: 'insensitive' } },
      ];
    }
    if (params.role) {
      where.role = params.role;
    }

    return this.prisma.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        _count: {
          select: { ownedStations: true, operatedStations: true }
        }
      }
    });
  }

  async getCrmStats() {
    const total = await this.prisma.user.count();
    const active = await this.prisma.user.count({ where: { status: 'Active' } });
    // Revenue mock (or sum transactions if possible)
    const totalRevenue = 125000;

    return {
      total,
      active,
      totalRevenue
    };
  }

  async findUserById(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async getCurrentUser(id: string) {
    return this.prisma.user.findUnique({
      where: { id },
      include: { organization: true }
    });
  }

  async updateUser(id: string, updateDto: UpdateUserDto) {
    try {
      const updated = await this.prisma.user.update({
        where: { id },
        data: updateDto
      });
      await this.syncOcpiTokenSafe(updated);
      return updated;
    } catch (error) {
      this.logger.error(`Failed to update user ${id}`, String(error).replace(/[\n\r]/g, ''));
      throw new BadRequestException('Could not update user');
    }
  }

  async deleteUser(id: string) {
    return this.prisma.user.delete({ where: { id } });
  }

  private constantTimeCompare(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
  }

  private async syncOcpiTokenSafe(user: any) {
    try {
      await this.ocpiTokenSync.syncUserToken(user);
    } catch (error) {
      this.logger.warn('Failed to sync OCPI token for user', String(error).replace(/[\n\r]/g, ''));
    }
  }

  private normalizeScopes(input: unknown): string[] {
    if (typeof input === 'string') {
      return input.split(' ').map((v) => v.trim()).filter(Boolean);
    }
    if (Array.isArray(input)) {
      return input.map((v) => String(v).trim()).filter(Boolean);
    }
    return [];
  }

  private verifyServiceSecret(secret: string, salt: string, expectedHash: string): boolean {
    const hash = crypto.scryptSync(secret, salt, 64).toString('hex');
    const expected = Buffer.from(expectedHash, 'hex');
    const actual = Buffer.from(hash, 'hex');
    if (expected.length !== actual.length) return false;
    return crypto.timingSafeEqual(expected, actual);
  }

  /**
   * Generate an email verification token
   */
  async generateEmailVerificationToken(userId: string, expiresIn: number = 86400000): Promise<string> {
    const token = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + expiresIn); // 24 hours by default

    await this.prisma.emailVerificationToken.create({
      data: {
        token,
        userId,
        expiresAt,
      },
    });

    this.logger.log(`Generated email verification token for user ${userId}`);
    return token;
  }

  /**
   * Verify an email verification token
   */
  async verifyEmailToken(token: string): Promise<{ userId: string; email: string }> {
    // Validate token format (must be a UUID)
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(token)) {
      throw new BadRequestException('Invalid verification token format');
    }

    const verificationToken = await this.prisma.emailVerificationToken.findUnique({
      where: { token },
      include: { user: true },
    });

    if (!verificationToken) {
      throw new BadRequestException('Invalid or expired verification token');
    }

    // Check if token has expired
    if (verificationToken.expiresAt < new Date()) {
      await this.prisma.emailVerificationToken.delete({ where: { id: verificationToken.id } });
      throw new BadRequestException('Verification token has expired');
    }

    // Mark email as verified and update status to AwaitingApproval
    const user = await this.prisma.user.update({
      where: { id: verificationToken.userId },
      data: {
        emailVerifiedAt: new Date(),
        status: 'AwaitingApproval' // Move to approval stage after email verification
      },
    });

    // Delete the used token
    await this.prisma.emailVerificationToken.delete({
      where: { id: verificationToken.id },
    });

    // Send application received email
    try {
      if (user.email) {
        await this.mailService.sendApplicationReceivedEmail(user.email, user.name);
      }
    } catch (error) {
      this.logger.error('Failed to send application received email', String(error).replace(/[\n\r]/g, ''));
    }

    this.logger.log(`Email verified for user ${user.id}, now awaiting admin approval`);
    return { userId: user.id, email: user.email || '' };
  }

  /**
   * Resend verification email
   */
  async resendVerificationEmail(email: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { email } });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (user.emailVerifiedAt) {
      throw new BadRequestException('Email is already verified');
    }

    // Delete any existing tokens for this user
    await this.prisma.emailVerificationToken.deleteMany({
      where: { userId: user.id },
    });

    // Generate new token
    const token = await this.generateEmailVerificationToken(user.id);

    // Send email
    try {
      await this.mailService.sendVerificationEmail(email, token);
    } catch (error) {
      this.logger.error(`Failed to send verification email to ${email}`, String(error).replace(/[\n\r]/g, ''));
      throw new Error('Failed to send verification email');
    }
  }

  /**
   * Request a password reset for a user
   */
  async requestPasswordReset(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.email) {
      throw new NotFoundException('User not found or has no email');
    }

    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expires = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

    await this.prisma.user.update({
      where: { id: userId },
      data: { otpCode: code, otpExpiresAt: expires },
    });

    try {
      await this.mailService.sendMail(
        user.email,
        'Password Reset Request',
        `<p>A password reset was requested for your account.</p>
         <p>Your reset code is: <b>${code}</b></p>
         <p>This code will expire in 15 minutes.</p>`
      );
    } catch (error) {
      this.logger.error(`Failed to send password reset email to ${user.email}`, error);
      throw new Error('Failed to send password reset email');
    }
  }

  /**
   * Force logout a user by revoking all their refresh tokens
   */
  async forceLogoutUser(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    this.logger.log(`Forced logout for user ${userId}`);
  }

  /**
   * Update whether a user is required to use MFA
   */
  async toggleMfaRequirement(userId: string, required: boolean): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { status: required ? 'MfaRequired' : 'Active' }
    });
  }
}