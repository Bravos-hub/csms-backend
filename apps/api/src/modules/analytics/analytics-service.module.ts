import { Module } from '@nestjs/common';
import { AnalyticsController } from './analytics-service.controller';
import { AnalyticsService } from './analytics-service.service';
import { HealthCheckService } from './health-check.service';
import { ServiceManagerService } from './service-manager.service';
import { PrismaModule } from '../../prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [AnalyticsController],
  providers: [AnalyticsService, HealthCheckService, ServiceManagerService],
  exports: [AnalyticsService, HealthCheckService],
})
export class AnalyticsServiceModule { }
