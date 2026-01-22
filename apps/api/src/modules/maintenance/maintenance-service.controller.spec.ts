import { Test, TestingModule } from '@nestjs/testing';
import { MaintenanceServiceController } from './maintenance-service.controller';
import { MaintenanceServiceService } from './maintenance-service.service';

describe('MaintenanceServiceController', () => {
  let maintenanceServiceController: MaintenanceServiceController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [MaintenanceServiceController],
      providers: [MaintenanceServiceService],
    }).compile();

    maintenanceServiceController = app.get<MaintenanceServiceController>(MaintenanceServiceController);
  });

  describe('root', () => {
    it('should return "Hello World!"', () => {
      expect(maintenanceServiceController.getHello()).toBe('Hello World!');
    });
  });
});
