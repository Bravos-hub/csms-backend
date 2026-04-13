import { BadRequestException } from '@nestjs/common';
import { TechniciansController } from './technicians.controller';
import { TechniciansService } from './technicians.service';

describe('TechniciansController', () => {
  it('rejects updateStatus when authenticated user is missing', async () => {
    const techniciansService = {
      updateStatus: jest.fn(),
    } as unknown as TechniciansService;
    const controller = new TechniciansController(techniciansService);

    await expect(
      controller.updateStatus(
        { user: undefined } as { user?: { sub?: string } },
        { status: 'active' },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
