import { Injectable, UnauthorizedException, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { UserRole } from '@prisma/client';
import { LoginDto, CreateUserDto, UpdateUserDto, InviteUserDto } from './dto/auth.dto';
import { NotificationService } from '../notification/notification-service.service';
import { MailService } from '../mail/mail.service';
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
  ) { }

  getHello(): string {
    return 'Auth Service Operational';
  }

  async login(loginDto: LoginDto) {
    const startTime = Date.now();
    try {
      const user = await this.prisma.user.findUnique({ where: { email: loginDto.email } });
      if (!user) {
        throw new UnauthorizedException('Invalid credentials');
      }

      if (!user.passwordHash) {
        throw new UnauthorizedException('Invalid credentials');
      }

      const isValid = await bcrypt.compare(loginDto.password, user.passwordHash);

      if (!isValid) {
        throw new UnauthorizedException('Invalid credentials');
      }

      const result = await this.issueTokens(user as any);

      this.metrics.recordAuthMetric({
        operation: 'login',
        success: true,
        duration: Date.now() - startTime,
        userId: user.id,
        timestamp: new Date(),
      });

      return result;
    } catch (error) {
      this.metrics.recordAuthMetric({
        operation: 'login',
        success: false,
        duration: Date.now() - startTime,
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date(),
      });
      throw error;
    }
  }

  async register(createUserDto: CreateUserDto) {
    const exists = await this.prisma.user.findUnique({ where: { email: createUserDto.email } });
    if (exists) {
      if (exists.status === 'Pending') {
        const verificationToken = await this.generateEmailVerificationToken(exists.id);
        try {
          await this.mailService.sendVerificationEmail(createUserDto.email, verificationToken);
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
          status: 'Pending',
          passwordHash: hashedPassword,
          country: createUserDto.country,
          region: createUserDto.region,
          subscribedPackage: createUserDto.subscribedPackage || 'Free',
          ownerCapability: createUserDto.ownerCapability as any,
          organizationId: organization.id,
        }
      });

      return { user, organization };
    });

    await this.syncOcpiTokenSafe(result.user);

    try {
      const verificationToken = await this.generateEmailVerificationToken(result.user.id);
      await this.mailService.sendVerificationEmail(createUserDto.email, verificationToken);
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

    const user = await this.prisma.user.create({
      data: {
        email: inviteDto.email,
        name: inviteDto.email.split('@')[0],
        role: inviteDto.role as unknown as UserRole,
        status: 'Invited',
      },
    });

    try {
      await this.mailService.sendInvitationEmail(inviteDto.email);
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
      { sub: user.id, type: 'refresh' },
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

  async findAllUsers() {
    return this.prisma.user.findMany();
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

    // Mark email as verified
    const user = await this.prisma.user.update({
      where: { id: verificationToken.userId },
      data: { emailVerifiedAt: new Date() },
    });

    // Delete the used token
    await this.prisma.emailVerificationToken.delete({
      where: { id: verificationToken.id },
    });

    this.logger.log(`Email verified for user ${user.id}`);
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
  }}