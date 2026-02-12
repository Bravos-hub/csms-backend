import { StationController } from './station-service.controller';

describe('StationController', () => {
  it('should be defined', () => {
    const controller = new StationController({} as any);
    expect(controller).toBeDefined();
  });
});
