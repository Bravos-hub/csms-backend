jest.mock('./station-service.service', () => ({
  StationService: class StationServiceMock { }
}));

import { StationController } from './station-service.controller';

describe('StationController bounds parsing', () => {
  const service = {
    findAllStations: jest.fn()
  };

  const controller = new StationController(service as any);

  beforeEach(() => {
    service.findAllStations.mockReset();
    service.findAllStations.mockResolvedValue([]);
  });

  it('passes undefined bounds when no query params are provided', async () => {
    await controller.findAll();

    expect(service.findAllStations).toHaveBeenCalledWith(undefined, undefined);
  });

  it('passes normalized bounds when all query params are provided', async () => {
    await controller.findAll('0.5608', '0.5780', '32.6368', '32.6456');

    expect(service.findAllStations).toHaveBeenCalledWith({
      north: 0.578,
      south: 0.5608,
      east: 32.6456,
      west: 32.6368
    }, undefined);
  });

  it('ignores bounds when only part of the query params are provided', async () => {
    await controller.findAll('0.578', undefined, '32.646', '32.637');

    expect(service.findAllStations).toHaveBeenCalledWith(undefined, undefined);
  });

  it('ignores bounds when a query param is not numeric', async () => {
    await controller.findAll('0.578', 'not-a-number', '32.646', '32.637');

    expect(service.findAllStations).toHaveBeenCalledWith(undefined, undefined);
  });

  it('passes search query when provided without bounds', async () => {
    await controller.findAll(undefined, undefined, undefined, undefined, 'kampala');

    expect(service.findAllStations).toHaveBeenCalledWith(undefined, 'kampala');
  });

  it('passes both normalized bounds and search query when provided', async () => {
    await controller.findAll('0.5608', '0.5780', '32.6368', '32.6456', 'kampala');

    expect(service.findAllStations).toHaveBeenCalledWith({
      north: 0.578,
      south: 0.5608,
      east: 32.6456,
      west: 32.6368
    }, 'kampala');
  });
});
