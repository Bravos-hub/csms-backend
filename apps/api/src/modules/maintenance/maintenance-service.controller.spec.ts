import { MaintenanceController } from './maintenance-service.controller';

describe('MaintenanceController', () => {
  it('should be defined', () => {
    const controller = new MaintenanceController({} as any);
    expect(controller).toBeDefined();
  });
});
