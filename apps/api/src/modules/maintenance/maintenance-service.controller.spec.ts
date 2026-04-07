import { MaintenanceController } from './maintenance-service.controller';
import { MaintenanceService } from './maintenance-service.service';

describe('MaintenanceController', () => {
  it('should be defined', () => {
    const controller = new MaintenanceController(
      {} as unknown as MaintenanceService,
    );
    expect(controller).toBeDefined();
  });
});
