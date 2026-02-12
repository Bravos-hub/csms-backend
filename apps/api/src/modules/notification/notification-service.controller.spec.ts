import { NotificationController } from './notification-service.controller';

describe('NotificationController', () => {
  it('should be defined', () => {
    const controller = new NotificationController({} as any);
    expect(controller).toBeDefined();
  });
});
