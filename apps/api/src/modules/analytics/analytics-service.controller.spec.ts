import { AnalyticsController } from './analytics-service.controller';

describe('AnalyticsController', () => {
  it('should be defined', () => {
    const controller = new AnalyticsController({} as any, {} as any);
    expect(controller).toBeDefined();
  });
});
