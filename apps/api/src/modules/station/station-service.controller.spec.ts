import { Test, TestingModule } from '@nestjs/testing';
import { StationServiceController } from './station-service.controller';
import { StationServiceService } from './station-service.service';

describe('StationServiceController', () => {
  let stationServiceController: StationServiceController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [StationServiceController],
      providers: [StationServiceService],
    }).compile();

    stationServiceController = app.get<StationServiceController>(StationServiceController);
  });

  describe('root', () => {
    it('should return "Hello World!"', () => {
      expect(stationServiceController.getHello()).toBe('Hello World!');
    });
  });
});
