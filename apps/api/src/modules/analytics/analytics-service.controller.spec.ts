import { AnalyticsController } from './analytics-service.controller';
import { AnalyticsService } from './analytics-service.service';
import { ServiceManagerService } from './service-manager.service';

describe('AnalyticsController', () => {
  it('should be defined', () => {
    const analyticsService = {} as unknown as AnalyticsService;
    const serviceManager = {} as unknown as ServiceManagerService;
    const controller = new AnalyticsController(
      analyticsService,
      serviceManager,
    );
    expect(controller).toBeDefined();
  });
});
