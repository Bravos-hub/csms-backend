import { BadRequestException } from '@nestjs/common';
import { AttendantController } from './attendant.controller';
import { AttendantService } from './attendant.service';

describe('AttendantController', () => {
  it('rejects protected calls when authenticated user is missing', () => {
    const attendantService = {
      listMobileJobs: jest.fn(),
    } as unknown as AttendantService;
    const controller = new AttendantController(attendantService);

    expect(() =>
      controller.listMobileJobs({ user: undefined } as {
        user?: { sub?: string };
      }),
    ).toThrow(BadRequestException);
  });
});
