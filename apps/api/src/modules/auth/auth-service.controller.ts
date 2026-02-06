import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Req,
  Res,
  UseGuards,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import type { Response, Request } from 'express';
import { ApiTags, ApiOperation, ApiResponse, ApiBody, ApiCookieAuth } from '@nestjs/swagger';
import { AuthService } from './auth-service.service';
import { MetricsService } from '../../common/services/metrics.service';
import {
  LoginDto,
  RefreshTokenDto,
  InviteUserDto,
  UpdateUserDto,
  ServiceTokenRequestDto,
} from './dto/auth.dto';
import { COOKIE_NAMES, getCookieOptions } from '../../common/utils/cookie.config';

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private readonly authService: AuthService,
    private readonly metricsService: MetricsService,
  ) { }

  @Get('metrics')
  @ApiOperation({ summary: 'Get authentication metrics' })
  getMetrics() {
    return this.metricsService.getMetricsSummary();
  }

  @Post('login')
  @ApiOperation({
    summary: 'User login',
    description: 'Authenticates user and sets httpOnly cookies for access and refresh tokens',
  })
  @ApiBody({ type: LoginDto })
  @ApiResponse({
    status: 200,
    description: 'Login successful. Cookies set: evzone_access_token, evzone_refresh_token',
  })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  async login(
    @Body() loginDto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.login(loginDto);

    // Set httpOnly cookies
    res.cookie(COOKIE_NAMES.ACCESS_TOKEN, result.accessToken, getCookieOptions(false));
    res.cookie(COOKIE_NAMES.REFRESH_TOKEN, result.refreshToken, getCookieOptions(true));

    // Return tokens and user data for localStorage persistence
    return {
      user: result.user,
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
    };
  }

  @Post('refresh')
  @ApiCookieAuth('evzone_refresh_token')
  @ApiOperation({
    summary: 'Refresh access token',
    description: 'Uses refresh token from cookie or request body to generate new access token',
  })
  @ApiBody({ type: RefreshTokenDto, required: false })
  @ApiResponse({
    status: 200,
    description: 'Token refreshed successfully. New cookies set.',
  })
  async refresh(
    @Body() body: Partial<RefreshTokenDto>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    // Extract refresh token from cookie or request body
    const refreshToken = req.cookies?.[COOKIE_NAMES.REFRESH_TOKEN] || body.refreshToken;

    if (!refreshToken) {
      throw new BadRequestException('Refresh token not found in cookie or request body');
    }

    const result = await this.authService.refresh(refreshToken);

    // Set new httpOnly cookies
    res.cookie(COOKIE_NAMES.ACCESS_TOKEN, result.accessToken, getCookieOptions(false));
    res.cookie(COOKIE_NAMES.REFRESH_TOKEN, result.refreshToken, getCookieOptions(true));

    // Return tokens in body as well for localStorage persistence
    return {
      user: result.user,
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
    };
  }

  @Post('register')
  @ApiOperation({ summary: 'Register new user' })
  async register(
    @Body() createUserDto: any,
    @Req() req: Request,
  ) {
    if (!createUserDto.frontendUrl) {
      const origin = req.headers.origin as string;
      const host = req.headers.host;
      // Only use origin if it exists and is different from the backend's own host
      if (origin && (!host || !origin.includes(host))) {
        createUserDto.frontendUrl = origin;
      }
    }
    // Registration only initiates verification, it does not log in the user
    return this.authService.register(createUserDto);
  }

  @Post('logout')
  @ApiOperation({
    summary: 'User logout',
    description: 'Revokes refresh token and clears authentication cookies',
  })
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    // Extract refresh token from cookie
    const refreshToken = req.cookies?.[COOKIE_NAMES.REFRESH_TOKEN];

    if (refreshToken) {
      // Revoke the refresh token in database
      await this.authService.revokeRefreshToken(refreshToken);
    }

    // Clear cookies
    res.clearCookie(COOKIE_NAMES.ACCESS_TOKEN);
    res.clearCookie(COOKIE_NAMES.REFRESH_TOKEN);

    return {
      success: true,
      message: 'Logged out successfully',
    };
  }

  @Post('service/token')
  @ApiOperation({ summary: 'Issue service account token' })
  serviceToken(@Req() req: any, @Body() body: ServiceTokenRequestDto) {
    const authHeader = req.headers.authorization as string | undefined;
    let clientId = body.clientId;
    let clientSecret = body.clientSecret;

    if (authHeader?.startsWith('Basic ')) {
      const encoded = authHeader.substring(6).trim();
      const decoded = Buffer.from(encoded, 'base64').toString('utf8');
      const separatorIndex = decoded.indexOf(':');
      if (separatorIndex > 0) {
        clientId = clientId || decoded.slice(0, separatorIndex);
        clientSecret = clientSecret || decoded.slice(separatorIndex + 1);
      }
    }

    if (!clientId || !clientSecret) {
      throw new BadRequestException('clientId and clientSecret are required');
    }

    return this.authService.issueServiceToken(clientId, clientSecret, body.scope);
  }

  // OTP Endpoints
  @Post('otp/send')
  @ApiOperation({ summary: 'Request OTP' })
  requestOtp(@Body() body: { phone?: string; email?: string }) {
    if (!body.phone && !body.email)
      throw new BadRequestException('Phone or Email is required');
    return this.authService.requestOtp(body.phone || body.email || '');
  }

  @Post('otp/verify')
  @ApiOperation({ summary: 'Verify OTP' })
  verifyOtp(@Body() body: { phone?: string; email?: string; code: string }) {
    if ((!body.phone && !body.email) || !body.code)
      throw new BadRequestException('Phone/Email and code are required');
    return this.authService.verifyOtp(body.phone || body.email || '', body.code);
  }

  @Post('password/reset')
  @ApiOperation({ summary: 'Reset password' })
  resetPassword(@Body() body: any) {
    this.logger.log('Password reset request received');

    const identifier = body.email || body.phone || body.identifier;
    const otp = body.code || body.token || body.otp;
    const pass = body.newPassword || body.password;

    if (!identifier || !otp || !pass) {
      this.logger.warn('Password reset failed: missing required fields');
      throw new BadRequestException(
        'Email/Phone, OTP code, and new password are required',
      );
    }
    return this.authService.resetPassword(identifier, otp, pass);
  }

  @Post('verify-email')
  @ApiOperation({ summary: 'Verify email with token' })
  @ApiBody({ schema: { properties: { token: { type: 'string' } } } })
  @ApiResponse({
    status: 200,
    description: 'Email verified successfully',
  })
  @ApiResponse({ status: 400, description: 'Invalid or expired token' })
  async verifyEmail(@Body() body: { token: string }) {
    if (!body.token) {
      throw new BadRequestException('Verification token is required');
    }
    return this.authService.verifyEmailToken(body.token);
  }

  @Post('resend-verification-email')
  @ApiOperation({ summary: 'Resend verification email' })
  @ApiBody({ schema: { properties: { email: { type: 'string' } } } })
  @ApiResponse({
    status: 200,
    description: 'Verification email sent',
  })
  async resendVerificationEmail(@Body() body: { email: string }) {
    if (!body.email) {
      throw new BadRequestException('Email is required');
    }
    await this.authService.resendVerificationEmail(body.email);
    return { success: true, message: 'Verification email sent' };
  }
}

@Controller('users')
export class UsersController {
  constructor(private readonly authService: AuthService) { }

  @Get('me')
  getMe(@Req() req: any) {
    const userId = req.headers['x-user-id'] || 'mock-id';
    return this.authService.getCurrentUser(userId);
  }

  @Get()
  findAll() {
    return this.authService.findAllUsers();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.authService.findUserById(id);
  }

  @Post('invite')
  invite(@Body() inviteDto: InviteUserDto, @Req() req: Request) {
    if (!inviteDto.frontendUrl) {
      const origin = req.headers.origin as string;
      const host = req.headers.host;
      // Only use origin if it exists and is different from the backend's own host
      if (origin && (!host || !origin.includes(host))) {
        inviteDto.frontendUrl = origin;
      }
    }
    return this.authService.inviteUser(inviteDto);
  }

  @Patch('me')
  async updateMe(@Req() req: any, @Body() updateDto: UpdateUserDto) {
    try {
      const userId = req.headers['x-user-id'] || 'mock-id';
      return await this.authService.updateUser(userId, updateDto);
    } catch (error) {
      throw error;
    }
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateDto: UpdateUserDto) {
    return this.authService.updateUser(id, updateDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.authService.deleteUser(id);
  }

  @Post(':id/reset-password')
  @ApiOperation({ summary: 'Trigger password reset email for a user' })
  requestReset(@Param('id') id: string) {
    return this.authService.requestPasswordReset(id);
  }

  @Post(':id/force-logout')
  @ApiOperation({ summary: 'Invalidate all sessions for a user' })
  forceLogout(@Param('id') id: string) {
    return this.authService.forceLogoutUser(id);
  }

  @Post(':id/mfa-requirement')
  @ApiOperation({ summary: 'Toggle MFA requirement for a user' })
  toggleMfa(@Param('id') id: string, @Body('required') required: boolean) {
    return this.authService.toggleMfaRequirement(id, required);
  }
}
