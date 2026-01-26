import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common'
import { CommandsService } from '../commands/commands.service'

@Controller('charge-points')
export class ChargePointsController {
  constructor(private readonly commands: CommandsService) {}

  @Get()
  getAll(@Query() query: any) {
    return []
  }

  @Get(':id')
  getById(@Param('id') id: string) {
    return { id }
  }

  @Post()
  create(@Body() payload: any) {
    return payload
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() payload: any) {
    return { id, ...payload }
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return { id }
  }

  @Post(':id/reboot')
  async reboot(@Param('id') id: string) {
    await this.commands.enqueueReset(id)
    return { id }
  }
}
