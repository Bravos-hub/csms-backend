import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { ConfigService } from '@nestjs/config';
import type { CommandsService } from '../commands/commands.service';
import type { PrismaService } from '../../prisma.service';
import { OcpiInternalController } from './ocpi-internal.controller';

type FindCommand = (
  args?: unknown,
) => Promise<{ id: string; status: string } | null>;
type FindChargePoint = (
  args?: unknown,
) => Promise<{ id: string; stationId: string } | null>;
type FindSession = (
  args?: unknown,
) => Promise<{ ocppId: string | null } | null>;
type EnqueueCommand = (args: Record<string, unknown>) => Promise<{
  commandId: string;
  status: string;
  requestedAt: string;
}>;
type ConfigGet = (key: string) => unknown;

describe('OcpiInternalController', () => {
  const prisma = {
    command: {
      findFirst: jest.fn<FindCommand>(),
    },
    chargePoint: {
      findUnique: jest.fn<FindChargePoint>(),
      findFirst: jest.fn<FindChargePoint>(),
    },
    session: {
      findFirst: jest.fn<FindSession>(),
    },
  };

  const commandsService = {
    enqueueCommand: jest.fn<EnqueueCommand>(),
  };

  const config = {
    get: jest.fn<ConfigGet>(),
  };

  let controller: OcpiInternalController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new OcpiInternalController(
      prisma as unknown as PrismaService,
      commandsService as unknown as CommandsService,
      config as unknown as ConfigService,
    );
  });

  it('maps RESERVE_NOW into the command pipeline', async () => {
    prisma.command.findFirst.mockResolvedValue(null);
    prisma.chargePoint.findUnique.mockResolvedValueOnce({
      id: 'cp-1',
      stationId: 'station-1',
    });
    commandsService.enqueueCommand.mockResolvedValue({
      commandId: 'cmd-1',
      status: 'Queued',
      requestedAt: '2026-03-29T10:00:00.000Z',
    });

    const result = await controller.createCommandRequest({
      version: '2.2.1',
      role: 'cpo',
      command: 'RESERVE_NOW',
      requestId: 'req-1',
      request: {
        evse_uid: 'CP-1',
        connector_id: 2,
        reservation_id: 77,
        expiry_date: '2026-03-30T12:00:00.000Z',
        authorization_reference: 'AUTH-123',
        response_url: 'https://partner.example/commands/result',
        token: {
          uid: 'TOKEN-123',
        },
      },
    });

    expect(commandsService.enqueueCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        commandType: 'ReserveNow',
        chargePointId: 'cp-1',
        stationId: 'station-1',
        connectorId: 2,
        correlationId: 'req-1',
        payload: expect.objectContaining({
          connectorId: 2,
          evseId: 2,
          reservationId: 77,
          id: 77,
          expiryDate: '2026-03-30T12:00:00.000Z',
          expiryDateTime: '2026-03-30T12:00:00.000Z',
          idTag: 'TOKEN-123',
          idToken: {
            idToken: 'TOKEN-123',
            type: 'Central',
          },
          parentIdTag: 'AUTH-123',
          groupIdToken: {
            idToken: 'AUTH-123',
            type: 'Central',
          },
          ocpi: expect.objectContaining({
            command: 'RESERVE_NOW',
            requestId: 'req-1',
            responseUrl: 'https://partner.example/commands/result',
          }),
        }),
      }),
    );
    expect(result).toEqual({
      result: 'ACCEPTED',
      timeout: 30,
      requestId: 'req-1',
      commandId: 'cmd-1',
    });
  });

  it('maps CANCEL_RESERVATION into the command pipeline', async () => {
    prisma.command.findFirst.mockResolvedValue(null);
    prisma.chargePoint.findUnique.mockResolvedValueOnce({
      id: 'cp-2',
      stationId: 'station-2',
    });
    commandsService.enqueueCommand.mockResolvedValue({
      commandId: 'cmd-2',
      status: 'Queued',
      requestedAt: '2026-03-29T10:05:00.000Z',
    });

    const result = await controller.createCommandRequest({
      version: '2.2.1',
      role: 'cpo',
      command: 'CANCEL_RESERVATION',
      requestId: 'req-2',
      request: {
        evse_uid: 'CP-2',
        reservation_id: 88,
      },
    });

    expect(commandsService.enqueueCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        commandType: 'CancelReservation',
        chargePointId: 'cp-2',
        stationId: 'station-2',
        payload: expect.objectContaining({
          reservationId: 88,
          id: 88,
          ocpi: expect.objectContaining({
            command: 'CANCEL_RESERVATION',
            requestId: 'req-2',
          }),
        }),
      }),
    );
    expect(result).toEqual({
      result: 'ACCEPTED',
      timeout: 30,
      requestId: 'req-2',
      commandId: 'cmd-2',
    });
  });

  it('rejects RESERVE_NOW without a reservation id', async () => {
    prisma.command.findFirst.mockResolvedValue(null);

    const result = await controller.createCommandRequest({
      version: '2.2.1',
      role: 'cpo',
      command: 'RESERVE_NOW',
      requestId: 'req-3',
      request: {
        evse_uid: 'CP-3',
        expiry_date: '2026-03-30T12:00:00.000Z',
      },
    });

    expect(result).toEqual({
      result: 'REJECTED',
      requestId: 'req-3',
      message: 'reservation_id is required for RESERVE_NOW',
    });
    expect(prisma.chargePoint.findUnique).not.toHaveBeenCalled();
    expect(commandsService.enqueueCommand).not.toHaveBeenCalled();
  });

  it('rejects CANCEL_RESERVATION without a reservation id', async () => {
    prisma.command.findFirst.mockResolvedValue(null);

    const result = await controller.createCommandRequest({
      version: '2.2.1',
      role: 'cpo',
      command: 'CANCEL_RESERVATION',
      requestId: 'req-4',
      request: {
        evse_uid: 'CP-4',
      },
    });

    expect(result).toEqual({
      result: 'REJECTED',
      requestId: 'req-4',
      message: 'reservation_id is required for CANCEL_RESERVATION',
    });
    expect(prisma.chargePoint.findUnique).not.toHaveBeenCalled();
    expect(commandsService.enqueueCommand).not.toHaveBeenCalled();
  });

  it('returns existing command for replayed requestId without enqueueing', async () => {
    prisma.command.findFirst.mockResolvedValue({
      id: 'existing-cmd-1',
      status: 'Queued',
    });

    const result = await controller.createCommandRequest({
      version: '2.2.1',
      role: 'cpo',
      command: 'RESERVE_NOW',
      requestId: 'req-duplicate-1',
      request: {
        evse_uid: 'CP-5',
        reservation_id: 501,
        expiry_date: '2026-03-30T12:00:00.000Z',
      },
    });

    expect(result).toEqual({
      result: 'ACCEPTED',
      requestId: 'req-duplicate-1',
      commandId: 'existing-cmd-1',
    });
    expect(commandsService.enqueueCommand).not.toHaveBeenCalled();
    expect(prisma.chargePoint.findUnique).not.toHaveBeenCalled();
  });
});
