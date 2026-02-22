import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { HttpMetricsInterceptor } from './http-metrics.interceptor';
import { HttpMetricsService } from './http-metrics.service';

@Global()
@Module({
  providers: [
    HttpMetricsService,
    {
      provide: APP_INTERCEPTOR,
      useClass: HttpMetricsInterceptor,
    },
  ],
  exports: [HttpMetricsService],
})
export class ObservabilityModule {}
