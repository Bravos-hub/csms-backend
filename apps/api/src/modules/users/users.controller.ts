import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common'

@Controller('users')
export class UsersController {
  @Get('me')
  getMe() {
    return { id: 'me' }
  }

  @Patch('me')
  updateMe(@Body() payload: any) {
    return payload
  }

  @Get()
  getAll() {
    return []
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
