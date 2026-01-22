import { Controller, Get, Post, Body, Patch, Param, Delete, Req, UseGuards } from '@nestjs/common';
import { AuthService } from './auth-service.service';
import { LoginDto, RefreshTokenDto, InviteUserDto, UpdateUserDto } from './dto/auth.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) { }

  @Post('login')
  login(@Body() loginDto: LoginDto) {
    return this.authService.login(loginDto);
  }

  @Post('refresh')
  refresh(@Body() refreshDto: RefreshTokenDto) {
    return this.authService.refresh(refreshDto.refreshToken);
  }

  @Post('register')
  register(@Body() createUserDto: any) { // using any or CreateUserDto if imported
    return this.authService.register(createUserDto);
  }

  @Post('logout')
  logout() {
    // In a real app, this would invalidate the refresh token
    // For now, just return success since client handles token removal
    return { success: true, message: 'Logged out successfully' };
  }

  // OTP Endpoints
  @Post('otp/send')
  requestOtp(@Body() body: { phone?: string, email?: string }) {
    if (!body.phone && !body.email) throw new Error('Phone or Email is required');
    return this.authService.requestOtp(body.phone || body.email || '');
  }

  @Post('otp/verify')
  verifyOtp(@Body() body: { phone?: string, email?: string, code: string }) {
    if ((!body.phone && !body.email) || !body.code) throw new Error('Phone/Email and code are required');
    return this.authService.verifyOtp(body.phone || body.email || '', body.code);
  }

  @Post('password/reset')
  resetPassword(@Body() body: any) {
    console.log('Password reset request body:', JSON.stringify(body, null, 2));

    const identifier = body.email || body.phone || body.identifier;
    const otp = body.code || body.token || body.otp;
    const pass = body.newPassword || body.password;

    console.log('Extracted values:', { identifier, otp, pass });

    if (!identifier || !otp || !pass) {
      console.error('Missing required fields:', {
        hasIdentifier: !!identifier,
        hasOtp: !!otp,
        hasPassword: !!pass,
        receivedKeys: Object.keys(body)
      });
      throw new Error('Email/Phone, OTP code, and new password are required');
    }
    return this.authService.resetPassword(identifier, otp, pass);
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
  invite(@Body() inviteDto: InviteUserDto) {
    return this.authService.inviteUser(inviteDto);
  }

  @Patch('me')
  updateMe(@Req() req: any, @Body() updateDto: UpdateUserDto) {
    const userId = req.headers['x-user-id'] || 'mock-id';
    return this.authService.updateUser(userId, updateDto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateDto: UpdateUserDto) {
    return this.authService.updateUser(id, updateDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.authService.deleteUser(id);
  }
}
