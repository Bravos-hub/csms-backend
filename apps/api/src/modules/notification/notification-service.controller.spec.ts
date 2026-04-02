import { NotificationController } from './notification-service.controller';
import { NotificationService } from './notification-service.service';

describe('NotificationController', () => {
  it('should be defined', () => {
    const notificationService = {} as unknown as NotificationService;
    const controller = new NotificationController(notificationService);
    expect(controller).toBeDefined();
  });
});
