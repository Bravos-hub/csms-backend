/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */
import {
  BadRequestException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
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

  it('queues sync actions and returns queued status', async () => {
    service.requireAssignment = jest.fn().mockResolvedValue({ id: 'assign-1' });
    service.config = {
      get: jest
        .fn()
        .mockImplementation((key: string) =>
          key === 'ATTENDANT_SYNC_ENABLED' ? 'true' : null,
        ),
    };

    const existingLookup = jest.fn().mockResolvedValue(null);
    const createAction = jest.fn().mockResolvedValue({
      id: 'sync-1',
      idempotencyKey: 'key-1',
      actionType: 'PORT_UPDATE',
      status: 'QUEUED',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      processedAt: null,
      errorMessage: null,
    });

    service.prisma = {
      $transaction: jest.fn().mockImplementation(
        (
          callback: (transactionClient: {
            attendantSyncAction: {
              findUnique: typeof existingLookup;
              create: typeof createAction;
            };
          }) => Promise<unknown>,
        ) =>
          callback({
            attendantSyncAction: {
              findUnique: existingLookup,
              create: createAction,
            },
          }),
      ),
    };

    const result = await service.syncBatch('user-1', {
      actions: [
        {
          idempotencyKey: 'key-1',
          type: 'PORT_UPDATE',
          payload: { portId: 'cp-1' },
        },
      ],
    });

    expect(result.actions).toHaveLength(1);
    expect(result.actions[0]).toMatchObject({
      idempotencyKey: 'key-1',
      type: 'PORT_UPDATE',
      status: 'QUEUED',
      replayed: false,
    });
    expect(existingLookup).toHaveBeenCalledTimes(1);
    expect(createAction).toHaveBeenCalledTimes(1);
  });

  it('replays existing sync action by idempotency key without duplicate create', async () => {
    service.requireAssignment = jest.fn().mockResolvedValue({ id: 'assign-1' });
    service.config = {
      get: jest
        .fn()
        .mockImplementation((key: string) =>
          key === 'ATTENDANT_SYNC_ENABLED' ? 'true' : null,
        ),
    };

    const existingLookup = jest.fn().mockResolvedValue({
      id: 'sync-existing',
      idempotencyKey: 'key-existing',
      actionType: 'BOOKING_UPSERT',
      status: 'PROCESSED',
      createdAt: new Date('2026-01-02T00:00:00.000Z'),
      updatedAt: new Date('2026-01-02T00:00:00.000Z'),
      processedAt: new Date('2026-01-02T00:01:00.000Z'),
      errorMessage: null,
    });
    const createAction = jest.fn();

    service.prisma = {
      $transaction: jest.fn().mockImplementation(
        (
          callback: (transactionClient: {
            attendantSyncAction: {
              findUnique: typeof existingLookup;
              create: typeof createAction;
            };
          }) => Promise<unknown>,
        ) =>
          callback({
            attendantSyncAction: {
              findUnique: existingLookup,
              create: createAction,
            },
          }),
      ),
    };

    const result = await service.syncBatch('user-1', {
      actions: [
        {
          idempotencyKey: 'key-existing',
          type: 'BOOKING_UPSERT',
          payload: { bookingId: 'b-1' },
        },
      ],
    });

    expect(result.actions).toHaveLength(1);
    expect(result.actions[0]).toMatchObject({
      idempotencyKey: 'key-existing',
      status: 'PROCESSED',
      replayed: true,
    });
    expect(createAction).not.toHaveBeenCalled();
  });

  it('throws when sync batch is disabled', async () => {
    service.requireAssignment = jest.fn().mockResolvedValue({ id: 'assign-1' });
    service.config = {
      get: jest
        .fn()
        .mockImplementation((key: string) =>
          key === 'ATTENDANT_SYNC_ENABLED' ? 'false' : null,
        ),
    };

    await expect(
      service.syncBatch('user-1', {
        actions: [
          {
            idempotencyKey: 'key-1',
            type: 'PORT_UPDATE',
            payload: {},
          },
        ],
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('throws for invalid sync action createdAt values', async () => {
    service.requireAssignment = jest.fn().mockResolvedValue({ id: 'assign-1' });
    service.config = {
      get: jest
        .fn()
        .mockImplementation((key: string) =>
          key === 'ATTENDANT_SYNC_ENABLED' ? 'true' : null,
        ),
    };

    service.prisma = {
      $transaction: jest.fn().mockImplementation(
        (
          callback: (transactionClient: {
            attendantSyncAction: {
              findUnique: jest.Mock;
              create: jest.Mock;
            };
          }) => Promise<unknown>,
        ) =>
          callback({
            attendantSyncAction: {
              findUnique: jest.fn().mockResolvedValue(null),
              create: jest.fn(),
            },
          }),
      ),
    };

    await expect(
      service.syncBatch('user-1', {
        actions: [
          {
            idempotencyKey: 'key-1',
            type: 'PORT_UPDATE',
            payload: {},
            createdAt: 'not-a-date',
          },
        ],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
