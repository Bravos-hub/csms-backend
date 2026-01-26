import { Body, Controller, Get, Param, Post } from '@nestjs/common'
import { CommandsService } from './commands.service'

@Controller('commands')
export class CommandsController {
  constructor(private readonly commands: CommandsService) {}

  @Get(':id')
  getById(@Param('id') id: string) {
    return { id }
  }

  @Post()
  async create(@Body() payload: any) {
    return this.commands.enqueueCommand(payload)
  }
}
