import { Module } from '@nestjs/common';
import { AnalyticsController } from './analytics-service.controller';
import { AnalyticsService } from './analytics-service.service';

@Module({
  imports: [],
  controllers: [AnalyticsController],
  providers: [AnalyticsService],
})
export class AnalyticsServiceModule { }
