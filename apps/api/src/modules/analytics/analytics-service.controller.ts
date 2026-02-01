import { Controller, Get, Query } from '@nestjs/common';
import { AnalyticsService } from './analytics-service.service';

@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) { }

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
  getSystemHealth() {
    return this.analyticsService.getSystemHealth();
  }
}
