import { SessionService } from './session-service.service';
import { PrismaService } from '../../prisma.service';
import { NotificationService } from '../notification/notification-service.service';
import { OcpiTokenSyncService } from '../../common/services/ocpi-token-sync.service';
import { EnergyManagementService } from '../energy-management/energy-management.service';
import { TenantGuardrailsService } from '../../common/tenant/tenant-guardrails.service';

describe('SessionService OCPP TransactionEvent handling', () => {
  const prisma = {
    chargePoint: {
      findUnique: jest.fn(),
    },
    session: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
      findMany: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
    },
  };

  const notificationService = {
    sendSms: jest.fn(),
  };

  const ocpiTokenSync = {
    syncIdTagToken: jest.fn(),
  };

  const energyManagement = {
    recalculateStation: jest.fn(),
  };

  const tenantGuardrails = {
    requireTenantScope: jest
      .fn()
      .mockResolvedValue({ tenantId: 'tenant-1', cpoType: 'CHARGE' }),
    listOwnedStationIds: jest.fn().mockResolvedValue(['station-1']),
  };

  const service = new SessionService(
    prisma as unknown as PrismaService,
    notificationService as unknown as NotificationService,
    ocpiTokenSync as unknown as OcpiTokenSyncService,
    energyManagement as unknown as EnergyManagementService,
    tenantGuardrails as unknown as TenantGuardrailsService,
  );

  beforeEach(() => {
    prisma.chargePoint.findUnique.mockReset();
    prisma.session.create.mockReset();
    prisma.session.findUnique.mockReset();
    prisma.session.findFirst.mockReset();
    prisma.session.update.mockReset();
    prisma.user.findUnique.mockReset();
    ocpiTokenSync.syncIdTagToken.mockReset();
    notificationService.sendSms.mockReset();
    energyManagement.recalculateStation.mockReset();
    tenantGuardrails.requireTenantScope.mockReset();
    tenantGuardrails.requireTenantScope.mockResolvedValue({
      tenantId: 'tenant-1',
      cpoType: 'CHARGE',
    });
    tenantGuardrails.listOwnedStationIds.mockReset();
    tenantGuardrails.listOwnedStationIds.mockResolvedValue(['station-1']);
  });

  it('creates a session from OCPP 2.x TransactionEvent Started', async () => {
    prisma.session.findUnique.mockResolvedValueOnce(null);
    prisma.chargePoint.findUnique.mockResolvedValue({ stationId: 'station-1' });
    prisma.session.create.mockResolvedValue({});
    ocpiTokenSync.syncIdTagToken.mockResolvedValue(undefined);

    await service.handleOcppMessage({
      chargePointId: 'CP-1',
      eventType: 'SessionEvent',
      payload: {
        action: 'TransactionEvent',
        payload: {
          eventType: 'Started',
          timestamp: '2026-03-16T12:00:00.000Z',
          transactionInfo: { transactionId: 'tx-201' },
          evse: { id: 1, connectorId: 2 },
          idToken: { idToken: 'TAG-001' },
          meterValue: [
            {
              sampledValue: [
                {
                  value: '10',
                  measurand: 'Energy.Active.Import.Register',
                  unitOfMeasure: { unit: 'kWh' },
                },
              ],
            },
          ],
        },
      },
    });

    const createCalls = prisma.session.create.mock.calls as unknown[][];
    const createArg = createCalls[0]?.[0] as
      | {
          data: {
            ocppId: string;
            stationId: string;
            ocppTxId: string;
            connectorId: number;
            idTag: string;
            meterStart: number;
            status: string;
          };
        }
      | undefined;

    expect(createArg).toBeDefined();
    expect(createArg?.data).toMatchObject({
      ocppId: 'CP-1',
      stationId: 'station-1',
      ocppTxId: 'tx-201',
      connectorId: 2,
      idTag: 'TAG-001',
      meterStart: 10000,
      status: 'ACTIVE',
    });
  });

  it('completes a session from OCPP 2.x TransactionEvent Ended', async () => {
    prisma.session.findUnique.mockResolvedValue({
      id: 'session-1',
      ocppTxId: 'tx-201',
      meterStart: 10000,
      userId: null,
    });
    prisma.session.update.mockResolvedValue({
      id: 'session-1',
      userId: null,
    });

    await service.handleOcppMessage({
      chargePointId: 'CP-1',
      eventType: 'SessionEvent',
      payload: {
        action: 'TransactionEvent',
        payload: {
          eventType: 'Ended',
          timestamp: '2026-03-16T12:10:00.000Z',
          transactionInfo: { transactionId: 'tx-201' },
          meterValue: [
            {
              sampledValue: [
                {
                  value: '15',
                  measurand: 'Energy.Active.Import.Register',
                  unitOfMeasure: { unit: 'kWh' },
                },
              ],
            },
          ],
        },
      },
    });

    const updateCalls = prisma.session.update.mock.calls as unknown[][];
    const updateArg = updateCalls[0]?.[0] as
      | {
          where: { id: string };
          data: {
            meterStop: number;
            totalEnergy: number;
            status: string;
          };
        }
      | undefined;

    expect(updateArg).toBeDefined();
    expect(updateArg?.where).toEqual({ id: 'session-1' });
    expect(updateArg?.data).toMatchObject({
      meterStop: 15000,
      totalEnergy: 5000,
      status: 'COMPLETED',
    });
  });

  it('passes geo context when sending stop-session SMS notifications', async () => {
    prisma.session.findFirst.mockResolvedValue({
      id: 'session-1',
      status: 'ACTIVE',
      stationId: 'station-1',
    });
    prisma.session.update.mockResolvedValue({
      id: 'session-1',
      stationId: 'station-1',
      userId: 'user-1',
      totalEnergy: 2500,
      status: 'STOPPED',
    });
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      phone: '+256700000001',
      zoneId: 'zone-af-1',
      country: 'Uganda',
      region: 'AFRICA',
    });
    notificationService.sendSms.mockResolvedValue({ sid: 'sms-1' });

    await service.stopSession('session-1', {});
    await new Promise((resolve) => setImmediate(resolve));

    expect(notificationService.sendSms).toHaveBeenCalledWith(
      '+256700000001',
      'EvZone: Charging Stopped. Energy: 2500Wh. Est Cost: $1250.00',
      {
        userId: 'user-1',
        zoneId: 'zone-af-1',
        country: 'Uganda',
        region: 'AFRICA',
      },
    );
  });
});
