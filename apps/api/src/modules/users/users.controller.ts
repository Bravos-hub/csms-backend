import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common'
import { UsersService } from './users.service'

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) { }

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
  invite(@Body() payload: any) {
    return payload
  }
}
