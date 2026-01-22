import { Controller, Get, Post, Body, Param, Query } from '@nestjs/common';
import { EventPattern, Payload } from '@nestjs/microservices';
import { SessionService } from './session-service.service';
import { StopSessionDto, SessionFilterDto } from './dto/session.dto';

@Controller('sessions')
export class SessionController {
  constructor(private readonly sessionService: SessionService) { }

  @Get('active')
  getActive() {
    return this.sessionService.getActiveSessions();
  }

  @Get('stats/summary')
  getStats() {
    return this.sessionService.getStatsSummary();
  }

  @Get('history/all')
  getAllHistory(@Query() filter: SessionFilterDto) {
    return this.sessionService.getHistory(filter);
  }

  @Get(':id')
  getOne(@Param('id') id: string) {
    return this.sessionService.findById(id);
  }

  @Post(':id/stop')
  stop(@Param('id') id: string, @Body() dto: StopSessionDto) {
    return this.sessionService.stopSession(id, dto);
  }

  // Event handler (can be in controller or pure service call from gateway)
  @EventPattern('ocpp.message')
  async handleOcppMessage(@Payload() message: any) {
    await this.sessionService.handleOcppMessage(message);
  }
}
