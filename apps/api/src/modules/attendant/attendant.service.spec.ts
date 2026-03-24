/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */
import { UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { AttendantService } from './attendant.service';

jest.mock('bcrypt', () => ({
  compare: jest.fn(),
}));

describe('AttendantService', () => {
  const service = new AttendantService(
    {} as any,
    { get: () => null } as any,
    {} as any,
    {} as any,
  ) as any;

  beforeEach(() => {
    service.logger = {
      warn: jest.fn(),
      log: jest.fn(),
    };
    jest.clearAllMocks();
  });

  it('maps known port statuses and falls back unknown to fault', () => {
    expect(service.mapPortStatus('AVAILABLE')).toBe('available');
    expect(service.mapPortStatus('IN_USE')).toBe('in_use');
    expect(service.mapPortStatus('FULL')).toBe('full');
    expect(service.mapPortStatus('mystery')).toBe('fault');
  });

  it('handles overnight shifts when resolving assignment status', () => {
    service.currentMinutesInTimezone = () => 60; // 01:00
    expect(
      service.resolveAssignmentStatus('22:00', '06:00', 'Africa/Kampala', null),
    ).toBe('active');

    service.currentMinutesInTimezone = () => 12 * 60; // 12:00
    expect(
      service.resolveAssignmentStatus('22:00', '06:00', 'Africa/Kampala', null),
    ).toBe('off_shift');
  });

  it('applies assignment status override first', () => {
    service.currentMinutesInTimezone = () => 12 * 60;
    expect(
      service.resolveAssignmentStatus(
        '08:00',
        '16:00',
        'Africa/Kampala',
        'force_active',
      ),
    ).toBe('active');
    expect(
      service.resolveAssignmentStatus(
        '08:00',
        '16:00',
        'Africa/Kampala',
        'force_off_shift',
      ),
    ).toBe('off_shift');
  });

  it('logs invalid password attempts with hashed identifier metadata', async () => {
    service.findUserByIdentifier = jest.fn().mockResolvedValue({
      id: 'user-1',
      passwordHash: '$2b$10$stored-hash',
    });
    (bcrypt.compare as jest.Mock).mockResolvedValue(false as never);

    await expect(
      service.login({
        emailOrPhone: 'test1@evzonecharging.com',
        password: 'incorrect',
      }),
    ).rejects.toThrow(UnauthorizedException);

    expect(service.logger.warn).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(service.logger.warn.mock.calls[0][0]);
    expect(payload.event).toBe('attendant_login_failed');
    expect(payload.reason).toBe('invalid_password');
    expect(payload.identifierHash).toMatch(/^[a-f0-9]{16}$/);
  });

  it('returns unassigned result and logs assignment missing event', async () => {
    service.findUserByIdentifier = jest.fn().mockResolvedValue({
      id: 'user-1',
      passwordHash: '$2b$10$stored-hash',
    });
    service.findActiveAssignment = jest.fn().mockResolvedValue(null);
    (bcrypt.compare as jest.Mock).mockResolvedValue(true as never);

    const result = await service.login({
      emailOrPhone: 'test1@evzonecharging.com',
      password: 'correct-password',
    });

    expect(result.kind).toBe('unassigned');
    expect(result.identifier).toBe('test1@evzonecharging.com');
    expect(service.logger.log).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(service.logger.log.mock.calls[0][0]);
    expect(payload.event).toBe('attendant_login_unassigned');
    expect(payload.identifierHash).toMatch(/^[a-f0-9]{16}$/);
  });
});
