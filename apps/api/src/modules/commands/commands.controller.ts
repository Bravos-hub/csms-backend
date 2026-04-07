import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { CommandRequest } from '../../contracts/commands';
import { CommandsService } from './commands.service';

@Controller('commands')
export class CommandsController {
  constructor(private readonly commands: CommandsService) {}

  @Get()
  async list(
    @Query('chargePointId') chargePointId?: string,
    @Query('stationId') stationId?: string,
    @Query('limit') limit?: string,
  ) {
    if (!chargePointId || chargePointId.trim().length === 0) {
      return [];
    }
    const normalizedChargePointId = chargePointId.trim();
    const normalizedStationId = stationId?.trim() || undefined;

    const parsedLimit = Number(limit);
    return this.commands.listCommands({
      chargePointId: normalizedChargePointId,
      stationId: normalizedStationId,
      limit: Number.isFinite(parsedLimit) ? parsedLimit : undefined,
    });
  }

  @Get(':id')
  async getById(@Param('id') id: string) {
    const command = await this.commands.getCommandById(id);
    if (!command) {
      return { id, status: 'NOT_FOUND' };
    }
    return command;
  }

  @Post()
  async create(
    @Body()
    payload: Omit<CommandRequest, 'commandId' | 'requestedAt'> & {
      correlationId?: string;
    },
  ) {
    return this.commands.enqueueCommand(payload);
  }
}
