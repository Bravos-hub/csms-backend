import { Injectable, UnauthorizedException, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { LoginDto, CreateUserDto, UpdateUserDto, InviteUserDto } from './dto/auth.dto';
import { NotificationService } from '../notification/notification-service.service';
import { MailService } from '../mail/mail.service';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import * as jwt from 'jsonwebtoken';
import { SignOptions } from 'jsonwebtoken';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationService: NotificationService,
    private readonly mailService: MailService,
    private readonly config: ConfigService,
  ) { }

  getHello(): string {
    // Verified: Prisma Client regenerated
    return 'Auth Service Operational';
  }

  async login(loginDto: LoginDto) {
    const user = await this.prisma.user.findUnique({ where: { email: loginDto.email } });
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // CRITICAL: Use constant-time comparison to prevent timing attacks
    if (!user.passwordHash) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // TODO: Replace with bcrypt.compare(loginDto.password, user.passwordHash) in production
    const isValid = this.constantTimeCompare(user.passwordHash, loginDto.password);

    if (!isValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    return this.issueTokens(user as any);
  }

  async register(createUserDto: CreateUserDto) {
    const exists = await this.prisma.user.findUnique({ where: { email: createUserDto.email } });
    if (exists) {
      if (exists.status === 'Pending') {
        const verificationToken = Math.random().toString(36).substring(2) + Date.now().toString(36);
        try {
          await this.mailService.sendVerificationEmail(createUserDto.email, verificationToken);
        } catch (error) {
          this.logger.error('Failed to send verification email', String(error).replace(/[\n\r]/g, ''));
        }
        return { success: true, message: 'Registration successful. Please check your email.' };
      }
      throw new BadRequestException('User already exists');
    }

    // Check phone uniqueness if provided
    if (createUserDto.phone) {
      const phoneExists = await this.prisma.user.findUnique({ where: { phone: createUserDto.phone } });
      if (phoneExists) throw new BadRequestException('User with this phone number already exists');
    }

    // Simple random token for verify link
    const verificationToken = Math.random().toString(36).substring(2) + Date.now().toString(36);

    const user = await this.prisma.user.create({
      data: {
        email: createUserDto.email,
        name: createUserDto.name,
        phone: createUserDto.phone,
        role: (createUserDto.role as any) || 'SITE_OWNER',
        status: 'Pending',
        passwordHash: createUserDto.password, // In production: await bcrypt.hash(createUserDto.password, 10)
      }
    });

    try {
      await this.mailService.sendVerificationEmail(createUserDto.email, verificationToken);
    } catch (error) {
      this.logger.error('Failed to send verification email', String(error).replace(/[\n\r]/g, ''));
    }

    return { success: true, message: 'Registration successful. Please check your email.' };
  }

  async requestOtp(identifier: string) {
    const isEmail = identifier.includes('@');
    // Ensure identifier is not undefined
    if (!identifier) throw new BadRequestException('Identifier required');

    let user = await this.prisma.user.findFirst({
      where: isEmail ? { email: identifier } : { phone: identifier }
    });

    if (!user) {
      // For now, if user doesn't exist, we might create one or throw.
      // The user scenario "Forgot Password" implies user should exist.
      // But if it's a login flow via OTP, auto-creation is common.
      // Given the "User does not exist" complaint, let's create if not found for mobile logic, 
      // but for email usually we expect it to exist or we shouldn't leak existence.
      // However, to satisfy "User does not exist" yet "User already exists" confusion, handling both clearly.

      if (isEmail) {
        // If it's an email that doesn't exist, we probably shouldn't create a random user with just email for OTP if it's "Forgot Password". 
        // But sticking to the existing pattern of auto-create for phone:
        // Let's AUTO-CREATE for now to match strict "User does not exist" fix, 
        // or better, throw meaningful error if this is strictly for password reset.
        // Wait, the UI said "Forgot password?". So this IS password reset. 
        // We should NOT create a user if they don't exist in forgot password flow.
        throw new NotFoundException('User not found');
      }

      user = await this.prisma.user.create({
        data: { phone: identifier, name: 'Mobile User', status: 'Pending' }
      });
    }

    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expires = new Date(Date.now() + 5 * 60 * 1000);

    // Update
    await this.prisma.user.update({
      where: { id: user.id },
      data: { otpCode: code, otpExpiresAt: expires }
    });

    // Send via SMS or Email based on type
    if (isEmail) {
      await this.mailService.sendMail(user.email!, 'Password Reset OTP', `<p>Your OTP is <b>${code}</b></p>`);
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

    // Check if user is active or pending? 
    // Usually verifying OTP might activate them or just log them in.

    if (!user.otpCode || user.otpCode !== code) {
      throw new UnauthorizedException('Invalid OTP');
    }

    if (!user.otpExpiresAt || new Date() > user.otpExpiresAt) {
      throw new UnauthorizedException('OTP Expired');
    }

    // Valid
    const updatedUser = await this.prisma.user.update({
      where: { id: user.id },
      data: { status: 'Active' }
    });

    return this.issueTokens(updatedUser as any);
  }

  async resetPassword(identifier: string, code: string, newPassword: string) {
    const isEmail = identifier.includes('@');
    const user = await this.prisma.user.findFirst({
      where: isEmail ? { email: identifier } : { phone: identifier }
    });
    if (!user) throw new UnauthorizedException('User not found');

    // Use constant-time comparison to prevent timing attacks
    if (!user.otpCode || !this.constantTimeCompare(user.otpCode, code)) {
      throw new UnauthorizedException('Invalid OTP');
    }

    if (!user.otpExpiresAt || new Date() > user.otpExpiresAt) {
      throw new UnauthorizedException('OTP Expired');
    }

    // Valid - update password and clear OTP
    // In a real app, hash the password. For now, storing as-is for simplicity
    const updatedUser = await this.prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: newPassword, // In production: await bcrypt.hash(newPassword, 10)
        otpCode: null,
        otpExpiresAt: null,
        status: 'Active'
      }
    });

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
      { expiresIn: this.config.get<string>('JWT_ACCESS_EXPIRY') || '15m' } as SignOptions
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
      user: { id: user.id, email: user.email, phone: user.phone, role: user.role, name: user.name }
    };
  }

  private constantTimeCompare(a: string, b: string): boolean {
    if (a.length !== b.length) {
      return false;
    }
    return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
  }

  async refresh(refreshToken: string) {
    const secret = this.config.get<string>('JWT_SECRET');
    if (!secret) {
      throw new Error('JWT_SECRET not configured');
    }

    let payload: any;
    try {
      payload = jwt.verify(refreshToken, secret);
    } catch (error) {
      throw new UnauthorizedException('Invalid token');
    }

    if (payload.type !== 'refresh') {
      throw new UnauthorizedException('Invalid token type');
    }

    const storedToken = await this.prisma.refreshToken.findFirst({
      where: {
        token: refreshToken,
        userId: payload.sub,
        expiresAt: { gt: new Date() },
        revokedAt: null,
      },
    });

    if (!storedToken) {
      throw new UnauthorizedException('Token not found or expired');
    }

    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    const accessToken = jwt.sign(
      { sub: user.id, email: user.email, role: user.role },
      secret as jwt.Secret,
      { expiresIn: this.config.get<string>('JWT_ACCESS_EXPIRY') || '15m' } as SignOptions
    );

    return { accessToken };
  }

  // User Management
  async findAllUsers() {
    try {
      return await this.prisma.user.findMany();
    } catch (error) {
      this.logger.error('Failed to fetch all users', String(error).replace(/[\n\r]/g, ''));
      throw new BadRequestException('Could not fetch users');
    }
  }

  async findUserById(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async getCurrentUser(id: string) {
    return this.prisma.user.findUnique({ where: { id } });
  }

  async inviteUser(inviteDto: InviteUserDto) {
    try {
      const exists = await this.prisma.user.findUnique({ where: { email: inviteDto.email } });
      if (exists) throw new BadRequestException('User already exists');

      return await this.prisma.user.create({
        data: {
          email: inviteDto.email,
          role: inviteDto.role as any,
          name: inviteDto.email.split('@')[0],
          status: 'Invited'
        }
      });
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      this.logger.error(`Failed to invite user: ${inviteDto.email}`, String(error).replace(/[\n\r]/g, ''));
      throw new BadRequestException('Could not invite user');
    }
  }

  async updateUser(id: string, updateDto: UpdateUserDto) {
    try {
      const user = await this.findUserById(id);
      return await this.prisma.user.update({
        where: { id },
        data: updateDto
      });
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      this.logger.error(`Failed to update user ${id}`, String(error).replace(/[\n\r]/g, ''));
      throw new BadRequestException('Could not update user');
    }
  }

  async deleteUser(id: string) {
    return this.prisma.user.delete({ where: { id } });
  }
}
