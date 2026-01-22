import { Injectable, UnauthorizedException, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { LoginDto, CreateUserDto, UpdateUserDto, InviteUserDto } from './dto/auth.dto';
import { NotificationService } from '../notification/notification-service.service';
import { MailService } from '../mail/mail.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationService: NotificationService,
    private readonly mailService: MailService,
  ) { }

  getHello(): string {
    return 'Auth Service Operational';
  }

  async login(loginDto: LoginDto) {
    const user = await this.prisma.user.findUnique({ where: { email: loginDto.email } });
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // In production, use bcrypt.compare(loginDto.password, user.passwordHash)
    // For now, simple equality check since we're not hashing yet
    if (user.passwordHash && user.passwordHash === loginDto.password) {
      return this.issueTokens(user as any);
    }

    // Fallback for demo/testing: accept 'password' if no passwordHash is set
    if (!user.passwordHash && loginDto.password === 'password') {
      return this.issueTokens(user as any);
    }

    throw new UnauthorizedException('Invalid credentials');
  }

  async register(createUserDto: CreateUserDto) {
    const exists = await this.prisma.user.findUnique({ where: { email: createUserDto.email } });
    if (exists) {
      if (exists.status === 'Pending') {
        const verificationToken = Math.random().toString(36).substring(2) + Date.now().toString(36);
        try {
          await this.mailService.sendVerificationEmail(createUserDto.email, verificationToken);
        } catch (error) {
          console.error('Failed to send verification email:', error);
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
        role: createUserDto.role || 'OWNER',
        status: 'Pending',
        passwordHash: createUserDto.password, // In production: await bcrypt.hash(createUserDto.password, 10)
      }
    });

    try {
      await this.mailService.sendVerificationEmail(createUserDto.email, verificationToken);
    } catch (error) {
      // Log error but don't fail registration in dev
      console.error('Failed to send verification email:', error);
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

    console.log('OTP Debug - Stored OTP:', user.otpCode);
    console.log('OTP Debug - Received OTP:', code);
    console.log('OTP Debug - Match:', user.otpCode === code);
    console.log('OTP Debug - Stored type:', typeof user.otpCode, 'Received type:', typeof code);

    if (!user.otpCode || user.otpCode !== code) {
      throw new UnauthorizedException('Invalid OTP');
    }

    if (!user.otpExpiresAt || new Date() > user.otpExpiresAt) {
      console.log('OTP Debug - Expiry:', user.otpExpiresAt, 'Now:', new Date());
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

  private issueTokens(user: any) {
    return {
      accessToken: 'mock_access_token_' + user.id,
      refreshToken: 'mock_refresh_token_' + user.id,
      user: { id: user.id, email: user.email, phone: user.phone, role: user.role, name: user.name }
    };
  }

  async refresh(refreshToken: string) {
    return { accessToken: 'new_mock_token' };
  }

  // User Management
  async findAllUsers() {
    return this.prisma.user.findMany();
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
    const exists = await this.prisma.user.findUnique({ where: { email: inviteDto.email } });
    if (exists) throw new BadRequestException('User already exists');

    return this.prisma.user.create({
      data: {
        email: inviteDto.email,
        role: inviteDto.role,
        name: inviteDto.email.split('@')[0],
        status: 'Invited'
      }
    });
  }

  async updateUser(id: string, updateDto: UpdateUserDto) {
    const user = await this.findUserById(id);
    return this.prisma.user.update({
      where: { id },
      data: updateDto
    });
  }

  async deleteUser(id: string) {
    return this.prisma.user.delete({ where: { id } });
  }
}
