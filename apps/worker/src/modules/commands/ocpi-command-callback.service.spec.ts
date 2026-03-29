import {
  afterAll,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import type { ConfigService } from '@nestjs/config';
import type { PrismaService } from '../../prisma.service';
import { OcpiCommandCallbackService } from './ocpi-command-callback.service';

type PartnerRecord = {
  tokenA: string | null;
  tokenB: string | null;
  tokenC: string | null;
};

type FindPartner = (args?: unknown) => Promise<PartnerRecord | null>;
type FindCommand = (args?: unknown) => Promise<{ payload: unknown } | null>;
type UpdateCommand = (args: {
  where: { id: string };
  data: { payload: unknown };
}) => Promise<{ id: string; payload: unknown }>;
type ConfigGet = (key: string) => string | undefined;

describe('OcpiCommandCallbackService', () => {
  const prisma = {
    ocpiPartner: {
      findUnique: jest.fn<FindPartner>(),
    },
    command: {
      findUnique: jest.fn<FindCommand>(),
      update: jest.fn<UpdateCommand>(),
    },
  };

  const config = {
    get: jest.fn<ConfigGet>(),
  };

  const originalFetch = global.fetch;
  const fetchMock = jest.fn<typeof fetch>();

  let service: OcpiCommandCallbackService;
  let commandPayload: Record<string, unknown>;
  let configValues: Record<string, string | undefined>;
  let partner: PartnerRecord | null;

  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as typeof fetch;

    commandPayload = {
      ocpi: {
        requestId: 'req-1',
      },
    };
    configValues = {
      OCPI_COMMAND_CALLBACKS_ENABLED: 'true',
      OCPI_COMMAND_CALLBACK_MAX_ATTEMPTS: '3',
      OCPI_COMMAND_CALLBACK_RETRY_DELAY_MS: '0',
      OCPI_COMMAND_CALLBACK_TIMEOUT_MS: '50',
    };
    partner = {
      tokenA: null,
      tokenB: null,
      tokenC: 'partner-token',
    };

    config.get.mockImplementation((key) => configValues[key]);
    prisma.ocpiPartner.findUnique.mockImplementation(() =>
      Promise.resolve(partner),
    );
    prisma.command.findUnique.mockImplementation(() =>
      Promise.resolve({
        payload: commandPayload,
      }),
    );
    prisma.command.update.mockImplementation((args) => {
      commandPayload = args.data.payload as Record<string, unknown>;
      return Promise.resolve({
        id: args.where.id,
        payload: commandPayload,
      });
    });

    service = new OcpiCommandCallbackService(
      config as unknown as ConfigService,
      prisma as unknown as PrismaService,
    );
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it('retries transient HTTP failures and records successful delivery', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response('retry', { status: 500 }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));

    await service.deliver({
      commandId: 'cmd-1',
      requestId: 'req-1',
      command: 'START_SESSION',
      responseUrl: 'https://partner.example.com/callback',
      partnerId: 'partner-1',
      status: 'Accepted',
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const requestInit = fetchMock.mock.calls[1]?.[1];
    expect(requestInit).toBeDefined();
    expect(requestInit?.headers).toEqual(
      expect.objectContaining({
        Authorization: 'Token partner-token',
        'Content-Type': 'application/json',
        'X-Correlation-ID': 'cmd-1',
        'X-Request-ID': 'req-1',
      }),
    );
    expect(requestInit?.body).toBe(JSON.stringify({ result: 'ACCEPTED' }));

    const ocpi = commandPayload.ocpi as Record<string, unknown>;
    expect(ocpi).toEqual(
      expect.objectContaining({
        callbackAttemptCount: 2,
        callbackDeliveredAt: expect.any(String),
        callbackDeliveryStatus: 'DELIVERED',
        callbackError: null,
        callbackFailedAt: null,
        callbackLastAttemptAt: expect.any(String),
        callbackLastHttpStatus: 200,
      }),
    );
  });

  it('does not retry hard client errors and records failure details', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('bad request', { status: 400 }),
    );

    await service.deliver({
      commandId: 'cmd-2',
      requestId: 'req-2',
      command: 'STOP_SESSION',
      responseUrl: 'https://partner.example.com/callback',
      partnerId: 'partner-1',
      status: 'Rejected',
      error: 'Rejected by operator',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const ocpi = commandPayload.ocpi as Record<string, unknown>;
    expect(ocpi).toEqual(
      expect.objectContaining({
        callbackAttemptCount: 1,
        callbackDeliveredAt: null,
        callbackDeliveryStatus: 'FAILED',
        callbackError: 'HTTP 400',
        callbackFailedAt: expect.any(String),
        callbackLastAttemptAt: expect.any(String),
        callbackLastHttpStatus: 400,
      }),
    );
  });

  it('retries request errors until the configured attempt limit', async () => {
    fetchMock.mockRejectedValue(new Error('socket hang up'));

    await service.deliver({
      commandId: 'cmd-3',
      requestId: 'req-3',
      command: 'RESERVE_NOW',
      responseUrl: 'https://partner.example.com/callback',
      partnerId: 'partner-1',
      status: 'Timeout',
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const ocpi = commandPayload.ocpi as Record<string, unknown>;
    expect(ocpi).toEqual(
      expect.objectContaining({
        callbackAttemptCount: 3,
        callbackDeliveredAt: null,
        callbackDeliveryStatus: 'FAILED',
        callbackError: 'socket hang up',
        callbackFailedAt: expect.any(String),
        callbackLastAttemptAt: expect.any(String),
        callbackLastHttpStatus: null,
      }),
    );
  });
});
