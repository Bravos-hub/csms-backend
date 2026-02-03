import { Controller, Get, Post, Param, Query, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { AnalyticsService } from './analytics-service.service';
import { ServiceManagerService } from './service-manager.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { UserRole } from '@prisma/client';

@Controller('analytics')
@UseGuards(JwtAuthGuard)
export class AnalyticsController {
  constructor(
    private readonly analyticsService: AnalyticsService,
    private readonly serviceManager: ServiceManagerService,
  ) { }

  @Get('dashboard')
  getDashboard(@Query('period') period = 'today') {
    return this.analyticsService.getDashboard(period);
  }

  @Get('uptime')
  getUptime(@Query('stationId') stationId?: string) {
    return this.analyticsService.getUptime(stationId);
  }

  @Get('usage')
  getUsage() {
    return this.analyticsService.getUsage();
  }

  @Get('realtime')
  getRealtime() {
    return this.analyticsService.getRealtime();
  }

  @Get('regions')
  getRegionalMetrics() {
    return this.analyticsService.getRegionalMetrics();
  }

  @Get('system-health')
  async getSystemHealth() {
    return this.analyticsService.getSystemHealth();
  }

  @Get('system-health/events')
  getSystemEvents(@Query('limit') limit?: string) {
    const parsedLimit = limit ? parseInt(limit, 10) : 50;
    return this.serviceManager.getSystemEvents(parsedLimit);
  }

  @Post('services/:serviceName/restart')
  @UseGuards(RolesGuard)
  @Roles(UserRole.SUPER_ADMIN, UserRole.EVZONE_ADMIN)
  @HttpCode(HttpStatus.OK)
  async restartService(@Param('serviceName') serviceName: string) {
    return this.serviceManager.restartService(serviceName);
  }

  @Get('services/:serviceName/logs')
  async getServiceLogs(
    @Param('serviceName') serviceName: string,
    @Query('lines') lines?: string,
  ) {
    const parsedLines = lines ? parseInt(lines, 10) : 100;
    return this.serviceManager.getServiceLogs(serviceName, parsedLines);
  }
}
