import { Controller, Get, Post, Body, Param, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { EventPattern, Payload } from '@nestjs/microservices';
import { SessionService } from './session-service.service';
import { StopSessionDto, SessionFilterDto } from './dto/session.dto';
import { KAFKA_TOPICS } from '../../contracts/kafka-topics';

type AuthenticatedRequest = Request & {
  user?: {
    role?: string;
    canonicalRole?: string;
    permissions?: string[];
  };
};

@Controller('sessions')
export class SessionController {
  constructor(private readonly sessionService: SessionService) {}

  @Get('active')
  getActive(
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Req() req?: AuthenticatedRequest,
  ) {
    return this.sessionService.getActiveSessions(limit, offset, req?.user);
  }

  @Get('stats/summary')
  getStats(@Req() req?: AuthenticatedRequest) {
    return this.sessionService.getStatsSummary(req?.user);
  }

  @Get('history/all')
  getAllHistory(
    @Query() filter: SessionFilterDto,
    @Req() req?: AuthenticatedRequest,
  ) {
    return this.sessionService.getHistory(filter, req?.user);
  }

  @Get(':id')
  getOne(@Param('id') id: string, @Req() req?: AuthenticatedRequest) {
    return this.sessionService.findById(id, undefined, req?.user);
  }

  @Post(':id/stop')
  stop(@Param('id') id: string, @Body() dto: StopSessionDto) {
    return this.sessionService.stopSession(id, dto);
  }

  // Event handler (can be in controller or pure service call from gateway)
  @EventPattern(KAFKA_TOPICS.sessionEvents)
  async handleOcppMessage(@Payload() message: any) {
    await this.sessionService.handleOcppMessage(message);
  }
}
