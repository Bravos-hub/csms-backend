import { StationController } from './station-service.controller';
import { StationService } from './station-service.service';

describe('StationController', () => {
  it('should be defined', () => {
    const stationService = {} as unknown as StationService;
    const controller = new StationController(stationService);
    expect(controller).toBeDefined();
  });
});
