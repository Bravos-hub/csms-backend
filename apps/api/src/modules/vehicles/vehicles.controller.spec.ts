import { UnauthorizedException } from '@nestjs/common';
import { VehiclesController } from './vehicles.controller';
import { VehiclesService } from './vehicles.service';

describe('VehiclesController', () => {
  const vehiclesService = {
    list: jest.fn(),
    getById: jest.fn(),
    create: jest.fn(),
    getActive: jest.fn(),
    setActive: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
    uploadPhoto: jest.fn(),
  };

  const controller = new VehiclesController(
    vehiclesService as unknown as VehiclesService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('lists vehicles with pagination and search', async () => {
    vehiclesService.list.mockResolvedValue({ data: [], total: 0 });

    await controller.list(
      { sub: 'user-1' },
      {
        scope: 'all',
        skip: 0,
        take: 10,
        search: 'Toyota',
      },
    );

    expect(vehiclesService.list).toHaveBeenCalledWith(
      'user-1',
      'all',
      undefined,
      0,
      10,
      'Toyota',
    );
  });

  it('gets a vehicle by id', async () => {
    vehiclesService.getById.mockResolvedValue({ id: 'veh-1' });

    const result = await controller.getById({ sub: 'user-1' }, 'veh-1');

    expect(vehiclesService.getById).toHaveBeenCalledWith('veh-1', 'user-1');
    expect(result).toEqual({ id: 'veh-1' });
  });

  it('rejects invalid authenticated user payload', () => {
    expect(() => controller.getById(null, 'veh-1')).toThrow(
      UnauthorizedException,
    );
    expect(vehiclesService.getById).not.toHaveBeenCalled();
  });
});
