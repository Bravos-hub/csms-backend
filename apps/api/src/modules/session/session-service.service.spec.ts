import { SessionService } from './session-service.service';

describe('SessionService OCPP TransactionEvent handling', () => {
  const prisma = {
    chargePoint: {
      findUnique: jest.fn(),
    },
    session: {
      create: jest.fn(),
      findUnique: jest.fn(),
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

  const service = new SessionService(
    prisma as any,
    notificationService as any,
    ocpiTokenSync as any,
  );

  beforeEach(() => {
    prisma.chargePoint.findUnique.mockReset();
    prisma.session.create.mockReset();
    prisma.session.findUnique.mockReset();
    prisma.session.update.mockReset();
    prisma.user.findUnique.mockReset();
    ocpiTokenSync.syncIdTagToken.mockReset();
    notificationService.sendSms.mockReset();
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

    expect(prisma.session.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        ocppId: 'CP-1',
        stationId: 'station-1',
        ocppTxId: 'tx-201',
        connectorId: 2,
        idTag: 'TAG-001',
        meterStart: 10000,
        status: 'ACTIVE',
      }),
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

    expect(prisma.session.update).toHaveBeenCalledWith({
      where: { id: 'session-1' },
      data: expect.objectContaining({
        meterStop: 15000,
        totalEnergy: 5000,
        status: 'COMPLETED',
      }),
    });
  });

  it('passes geo context when sending stop-session SMS notifications', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      phone: '+256700000001',
      zoneId: 'zone-af-1',
      country: 'Uganda',
      region: 'AFRICA',
    });
    notificationService.sendSms.mockResolvedValue({ sid: 'sms-1' });

    await (service as any).notifyUserOfStop('user-1', { totalEnergy: 2500 });

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
