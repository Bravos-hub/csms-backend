jest.mock('../../prisma.service', () => ({
  PrismaService: class PrismaServiceMock {},
}));

jest.mock('./provisioning/charger-provisioning.service', () => ({
  ChargerProvisioningService: class ChargerProvisioningServiceMock {},
}));

import { BadRequestException } from '@nestjs/common';
import { StationService } from './station-service.service';

describe('StationService charge point onboarding', () => {
  const prisma = {
    chargePoint: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    station: {
      findFirst: jest.fn(),
      create: jest.fn(),
    },
    ocpiPartnerLocation: {
      findMany: jest.fn(),
    },
    firmwareUpdateEvent: {
      upsert: jest.fn(),
      findMany: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  const provisioningService = {
    provision: jest.fn(),
  };

  const commands = {
    enqueueCommand: jest.fn(),
  };

  const ocpiService = {
    getChargePointRoamingPublication: jest.fn(),
    setChargePointRoamingPublication: jest.fn(),
  };

  const service = new StationService(
    prisma as any,
    provisioningService as any,
    commands as any,
    ocpiService as any,
  );

  beforeEach(() => {
    prisma.chargePoint.findUnique.mockReset();
    prisma.chargePoint.update.mockReset();
    prisma.station.findFirst.mockReset();
    prisma.station.create.mockReset();
    prisma.ocpiPartnerLocation.findMany.mockReset();
    prisma.ocpiPartnerLocation.findMany.mockResolvedValue([]);
    prisma.$transaction.mockReset();
    prisma.$transaction.mockImplementation(async (fn: any) => fn(prisma));
    provisioningService.provision.mockReset();
    ocpiService.getChargePointRoamingPublication.mockReset();
    ocpiService.setChargePointRoamingPublication.mockReset();
  });

  it('confirms identity and maps manufacturer into vendor field', async () => {
    prisma.chargePoint.findUnique.mockResolvedValueOnce({
      id: 'cp-1',
      stationId: 'station-1',
      ocppId: 'CP-001',
      model: null,
      vendor: null,
      firmwareVersion: null,
      station: { id: 'station-1', name: 'Station 1' },
    });
    ocpiService.getChargePointRoamingPublication.mockResolvedValue({
      chargePointId: 'cp-1',
      published: false,
      updatedAt: null,
    });
    prisma.chargePoint.update.mockResolvedValue({
      id: 'cp-1',
      stationId: 'station-1',
      ocppId: 'CP-001',
      model: 'ABB Terra 184',
      vendor: 'ABB',
      firmwareVersion: '1.4.2',
      station: { id: 'station-1', name: 'Station 1' },
    });

    await service.confirmChargePointIdentity('cp-1', {
      model: 'ABB Terra 184',
      manufacturer: 'ABB',
      firmwareVersion: '1.4.2',
    });

    expect(prisma.chargePoint.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'cp-1' },
        data: expect.objectContaining({
          model: 'ABB Terra 184',
          vendor: 'ABB',
          firmwareVersion: '1.4.2',
          identityConfirmedAt: expect.any(Date),
        }),
      }),
    );
  });

  it('rejects identity confirmation once the charge point is published', async () => {
    prisma.chargePoint.findUnique.mockResolvedValueOnce({
      id: 'cp-1',
      stationId: 'station-1',
      ocppId: 'CP-001',
      station: { id: 'station-1', name: 'Station 1' },
    });
    ocpiService.getChargePointRoamingPublication.mockResolvedValue({
      chargePointId: 'cp-1',
      published: true,
      updatedAt: '2026-04-06T10:00:00.000Z',
    });

    await expect(
      service.confirmChargePointIdentity('cp-1', {
        model: 'ABB Terra 184',
        manufacturer: 'ABB',
        firmwareVersion: '1.4.2',
      }),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.chargePoint.update).not.toHaveBeenCalled();
  });

  it('blocks publication when boot notification has not been received', async () => {
    prisma.chargePoint.findUnique.mockResolvedValueOnce({
      id: 'cp-1',
      stationId: 'station-1',
      ocppId: 'CP-001',
      model: 'ABB Terra 184',
      vendor: 'ABB',
      firmwareVersion: '1.4.2',
      bootNotificationAt: null,
      identityConfirmedAt: new Date('2026-04-06T10:00:00.000Z'),
      station: { id: 'station-1', name: 'Station 1' },
    });

    await expect(
      service.setChargePointPublication('cp-1', true),
    ).rejects.toThrow(BadRequestException);
    expect(ocpiService.setChargePointRoamingPublication).not.toHaveBeenCalled();
  });

  it('blocks publication when identity is not yet confirmed', async () => {
    prisma.chargePoint.findUnique.mockResolvedValueOnce({
      id: 'cp-1',
      stationId: 'station-1',
      ocppId: 'CP-001',
      model: 'ABB Terra 184',
      vendor: 'ABB',
      firmwareVersion: '1.4.2',
      bootNotificationAt: new Date('2026-04-06T10:00:00.000Z'),
      identityConfirmedAt: null,
      station: { id: 'station-1', name: 'Station 1' },
    });

    await expect(
      service.setChargePointPublication('cp-1', true),
    ).rejects.toThrow(BadRequestException);
    expect(ocpiService.setChargePointRoamingPublication).not.toHaveBeenCalled();
  });

  it('publishes when boot and confirmed identity preconditions are met', async () => {
    prisma.chargePoint.findUnique.mockResolvedValueOnce({
      id: 'cp-1',
      stationId: 'station-1',
      ocppId: 'CP-001',
      model: 'ABB Terra 184',
      vendor: 'ABB',
      firmwareVersion: '1.4.2',
      bootNotificationAt: new Date('2026-04-06T10:00:00.000Z'),
      identityConfirmedAt: new Date('2026-04-06T10:05:00.000Z'),
      station: { id: 'station-1', name: 'Station 1' },
    });
    ocpiService.setChargePointRoamingPublication.mockResolvedValue({
      chargePointId: 'cp-1',
      published: true,
      updatedAt: '2026-04-06T10:10:00.000Z',
    });

    const result = await service.setChargePointPublication('cp-1', true);

    expect(ocpiService.setChargePointRoamingPublication).toHaveBeenCalledWith(
      'cp-1',
      true,
    );
    expect(result).toEqual(
      expect.objectContaining({
        chargePointId: 'cp-1',
        published: true,
      }),
    );
  });

  it('applies boot identity when identity is not yet confirmed', async () => {
    prisma.chargePoint.findUnique.mockResolvedValueOnce({
      id: 'cp-1',
      ocppId: 'CP-001',
      ocppVersion: '1.6',
      identityConfirmedAt: null,
      model: null,
      vendor: null,
      firmwareVersion: null,
    });
    prisma.chargePoint.update.mockResolvedValue({
      id: 'cp-1',
      stationId: 'station-1',
      ocppId: 'CP-001',
      station: { id: 'station-1', site: null },
    });

    await service.handleOcppMessage({
      eventType: 'BootNotification',
      chargePointId: 'CP-001',
      ocppVersion: '1.6J',
      payload: {
        chargePointModel: 'ABB Terra 184',
        chargePointVendor: 'ABB',
        firmwareVersion: '1.4.2',
      },
    });

    const updateData = prisma.chargePoint.update.mock.calls[0][0].data;
    expect(updateData.model).toBe('ABB Terra 184');
    expect(updateData.vendor).toBe('ABB');
    expect(updateData.firmwareVersion).toBe('1.4.2');
    expect(updateData.bootNotificationAt).toBeInstanceOf(Date);
    expect(updateData.bootNotificationPayload).toEqual(
      expect.objectContaining({ chargePointModel: 'ABB Terra 184' }),
    );
  });

  it('does not overwrite confirmed identity fields on subsequent boot notifications', async () => {
    prisma.chargePoint.findUnique.mockResolvedValueOnce({
      id: 'cp-1',
      ocppId: 'CP-001',
      ocppVersion: '1.6',
      identityConfirmedAt: new Date('2026-04-06T10:00:00.000Z'),
      model: 'Confirmed Model',
      vendor: 'Confirmed Vendor',
      firmwareVersion: '9.9.9',
    });
    prisma.chargePoint.update.mockResolvedValue({
      id: 'cp-1',
      stationId: 'station-1',
      ocppId: 'CP-001',
      station: { id: 'station-1', site: null },
    });

    await service.handleOcppMessage({
      eventType: 'BootNotification',
      chargePointId: 'CP-001',
      ocppVersion: '1.6J',
      payload: {
        chargePointModel: 'Incoming Model',
        chargePointVendor: 'Incoming Vendor',
        firmwareVersion: '0.0.1',
      },
    });

    const updateData = prisma.chargePoint.update.mock.calls[0][0].data;
    expect(updateData.model).toBeUndefined();
    expect(updateData.vendor).toBeUndefined();
    expect(updateData.firmwareVersion).toBeUndefined();
    expect(updateData.bootNotificationAt).toBeInstanceOf(Date);
  });

  it('maps publication response into charge-point publication contract', async () => {
    prisma.chargePoint.findUnique.mockResolvedValueOnce({
      id: 'cp-1',
      stationId: 'station-1',
      ocppId: 'CP-001',
      station: { id: 'station-1', name: 'Station 1' },
    });
    ocpiService.getChargePointRoamingPublication.mockResolvedValue({
      chargePointId: 'cp-1',
      published: true,
      lastUpdatedAt: '2026-04-06T10:00:00.000Z',
    });

    const result = await service.getChargePointPublication('cp-1');

    expect(result).toEqual({
      chargePointId: 'cp-1',
      published: true,
      updatedAt: '2026-04-06T10:00:00.000Z',
    });
  });
});
