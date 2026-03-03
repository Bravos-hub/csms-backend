import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { CommandsService } from './commands.service';

@Controller('commands')
export class CommandsController {
  constructor(private readonly commands: CommandsService) {}

  @Get(':id')
  async getById(@Param('id') id: string) {
    const command = await this.commands.getCommandById(id);
    if (!command) {
      return { id, status: 'NOT_FOUND' };
    }
    return command;
  }

  @Post()
  async create(@Body() payload: any) {
    return this.commands.enqueueCommand(payload);
  }
}
