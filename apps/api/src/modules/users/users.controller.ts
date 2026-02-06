import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from '@nestjs/common'
import { UsersService } from './users.service'
import { AuthService } from '../auth/auth-service.service'

@Controller('users')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly authService: AuthService
  ) { }

  @Get('crm-stats')
  async getCrmStats() {
    return this.usersService.getCrmStats();
  }

  @Get('me')
  getMe() {
    return { id: 'me' }
  }

  @Patch('me')
  updateMe(@Body() payload: any) {
    return payload
  }

  @Get()
  getAll(@Query('q') search?: string, @Query('role') role?: any) {
    return this.usersService.findAll({ search, role });
  }

  @Get(':id/vehicles')
  getVehicles(@Param('id') id: string) {
    return []
  }

  @Get(':id/sessions')
  getSessions(@Param('id') id: string) {
    return []
  }

  @Get(':id')
  getById(@Param('id') id: string) {
    return { id }
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() payload: any) {
    return { id, ...payload }
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return { id }
  }

  @Post('invite')
  invite(@Body() inviteDto: any, @Req() req: any) {
    if (!inviteDto.frontendUrl) {
      const origin = req.headers.origin as string;
      const host = req.headers.host;
      if (origin && (!host || !origin.includes(host))) {
        inviteDto.frontendUrl = origin;
      }
    }
    return this.authService.inviteUser(inviteDto);
  }
}
