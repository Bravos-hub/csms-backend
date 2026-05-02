import { ForbiddenException } from '@nestjs/common';
import { DiagnosticsService } from './diagnostics.service';
import { PrismaService } from '../../prisma.service';
import { TenantContextService } from '@app/db';
import { EventStreamService } from '../sse/sse.service';
import { WebhooksService } from '../webhooks/webhooks.service';

describe('DiagnosticsService', () => {
  const prisma = {
    vehicle: {
      findUnique: jest.fn(),
    },
    vehicleFault: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
    },
    tenantMembership: {
      findFirst: jest.fn(),
    },
  };

  const tenantContext = {
    get: jest.fn(),
  };

  const events = {
    emit: jest.fn(),
  };

  const webhooks = {
    dispatchEvent: jest.fn(),
  };

  const service = new DiagnosticsService(
    prisma as unknown as PrismaService,
    tenantContext as unknown as TenantContextService,
    events as unknown as EventStreamService,
    webhooks as unknown as WebhooksService,
  );

  beforeEach(() => {
    prisma.vehicle.findUnique.mockReset();
    prisma.vehicleFault.findMany.mockReset();
    prisma.vehicleFault.findUnique.mockReset();
    prisma.vehicleFault.update.mockReset();
    prisma.user.findUnique.mockReset();
    prisma.tenantMembership.findFirst.mockReset();
    tenantContext.get.mockReset();
    events.emit.mockReset();
    webhooks.dispatchEvent.mockReset();
    tenantContext.get.mockReturnValue(null);
  });

  it('returns mapped open and acknowledged faults for a personal vehicle', async () => {
    const now = new Date('2026-05-02T08:00:00.000Z');
    prisma.vehicle.findUnique.mockResolvedValue({
      id: 'veh-1',
      userId: 'user-1',
      organizationId: null,
    });
    prisma.vehicleFault.findMany.mockResolvedValue([
      {
        id: 'fault-1',
        vehicleId: 'veh-1',
        code: 'BMS_TEMP',
        severity: 'CRITICAL',
        description: 'Battery over-temperature',
        status: 'OPEN',
        firstSeenAt: now,
        lastSeenAt: now,
        acknowledgedAt: null,
        resolvedAt: null,
        recommendedAction: 'Stop fast charging and inspect cooling loop',
      },
    ]);

    const result = await service.getFaults('user-1', 'veh-1');

    expect(prisma.vehicleFault.findMany).toHaveBeenCalledWith({
      where: { vehicleId: 'veh-1', status: { in: ['OPEN', 'ACKNOWLEDGED'] } },
      orderBy: [{ severity: 'desc' }, { lastSeenAt: 'desc' }],
    });
    expect(result).toEqual([
      {
        id: 'fault-1',
        vehicleId: 'veh-1',
        code: 'BMS_TEMP',
        severity: 'CRITICAL',
        description: 'Battery over-temperature',
        timestamp: '2026-05-02T08:00:00.000Z',
        status: 'OPEN',
        firstSeenAt: '2026-05-02T08:00:00.000Z',
        acknowledgedAt: null,
        resolvedAt: null,
        recommendedAction: 'Stop fast charging and inspect cooling loop',
      },
    ]);
  });

  it('allows tenant members with non-denied roles to acknowledge fleet faults', async () => {
    const acknowledgedAt = new Date('2026-05-02T08:15:00.000Z');
    prisma.vehicleFault.findUnique.mockResolvedValue({
      id: 'fault-tenant-1',
      vehicleId: 'veh-tenant-1',
      metadata: { existing: true },
      vehicle: {
        id: 'veh-tenant-1',
        userId: 'owner-1',
        organizationId: 'org-tenant-1',
      },
    });
    prisma.user.findUnique.mockResolvedValue({ role: 'DRIVER' });
    prisma.tenantMembership.findFirst.mockResolvedValue({
      roleKey: 'FLEET_MANAGER',
    });
    tenantContext.get.mockReturnValue({
      effectiveOrganizationId: 'org-tenant-1',
      authenticatedOrganizationId: 'org-tenant-1',
    });
    prisma.vehicleFault.update.mockResolvedValue({
      id: 'fault-tenant-1',
      status: 'ACKNOWLEDGED',
      acknowledgedAt,
    });

    const result = await service.acknowledgeFault(
      'user-tenant-1',
      'fault-tenant-1',
      'investigating',
    );

    expect(prisma.tenantMembership.findFirst).toHaveBeenCalledWith({
      where: {
        userId: 'user-tenant-1',
        organizationId: 'org-tenant-1',
        status: 'ACTIVE',
      },
      select: { roleKey: true },
    });
    expect(prisma.vehicleFault.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'fault-tenant-1' },
        data: expect.objectContaining({
          status: 'ACKNOWLEDGED',
          acknowledgedBy: 'user-tenant-1',
        }),
      }),
    );
    expect(result).toEqual({
      ok: true,
      faultId: 'fault-tenant-1',
      status: 'ACKNOWLEDGED',
      acknowledgedAt: acknowledgedAt.toISOString(),
    });
  });

  it('blocks tenant write operations for fleet-driver role', async () => {
    prisma.vehicleFault.findUnique.mockResolvedValue({
      id: 'fault-2',
      vehicleId: 'veh-2',
      metadata: null,
      vehicle: {
        id: 'veh-2',
        userId: 'user-2',
        organizationId: 'org-2',
      },
    });
    prisma.user.findUnique.mockResolvedValue({ role: 'DRIVER' });
    prisma.tenantMembership.findFirst.mockResolvedValue({ roleKey: 'FLEET_DRIVER' });

    await expect(
      service.acknowledgeFault('user-2', 'fault-2', 'ack'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.vehicleFault.update).not.toHaveBeenCalled();
  });

  it('blocks tenant write operations when active tenant context does not match vehicle tenant', async () => {
    prisma.vehicleFault.findUnique.mockResolvedValue({
      id: 'fault-ctx-1',
      vehicleId: 'veh-ctx-1',
      metadata: null,
      vehicle: {
        id: 'veh-ctx-1',
        userId: 'owner-ctx-1',
        organizationId: 'org-tenant-a',
      },
    });
    prisma.user.findUnique.mockResolvedValue({ role: 'DRIVER' });
    prisma.tenantMembership.findFirst.mockResolvedValue({
      roleKey: 'FLEET_MANAGER',
    });
    tenantContext.get.mockReturnValue({
      effectiveOrganizationId: 'org-tenant-b',
      authenticatedOrganizationId: 'org-tenant-b',
    });

    await expect(
      service.resolveFault('user-ctx-1', 'fault-ctx-1', 'resolved'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.vehicleFault.update).not.toHaveBeenCalled();
  });

  it('allows platform admins to modify tenant vehicle faults without tenant membership checks', async () => {
    const resolvedAt = new Date('2026-05-02T08:45:00.000Z');
    prisma.vehicleFault.findUnique.mockResolvedValue({
      id: 'fault-platform-1',
      vehicleId: 'veh-platform-1',
      code: 'HV_CONTACTOR',
      metadata: {},
      vehicle: {
        id: 'veh-platform-1',
        userId: 'owner-platform-1',
        organizationId: 'org-tenant-platform',
      },
    });
    prisma.user.findUnique.mockResolvedValue({ role: 'SUPER_ADMIN' });
    prisma.vehicleFault.update.mockResolvedValue({
      id: 'fault-platform-1',
      vehicleId: 'veh-platform-1',
      code: 'HV_CONTACTOR',
      status: 'RESOLVED',
      resolvedAt,
    });

    const result = await service.resolveFault(
      'platform-admin-1',
      'fault-platform-1',
      'remote fix',
    );

    expect(prisma.tenantMembership.findFirst).not.toHaveBeenCalled();
    expect(result).toEqual({
      ok: true,
      faultId: 'fault-platform-1',
      status: 'RESOLVED',
      resolvedAt: resolvedAt.toISOString(),
    });
  });

  it('resolves a fault and emits resolved events', async () => {
    const resolvedAt = new Date('2026-05-02T08:30:00.000Z');
    prisma.vehicleFault.findUnique.mockResolvedValue({
      id: 'fault-3',
      vehicleId: 'veh-3',
      code: 'HV_ISOLATION',
      metadata: {},
      vehicle: {
        id: 'veh-3',
        userId: 'user-3',
        organizationId: null,
      },
    });
    prisma.vehicleFault.update.mockResolvedValue({
      id: 'fault-3',
      vehicleId: 'veh-3',
      code: 'HV_ISOLATION',
      status: 'RESOLVED',
      resolvedAt,
    });

    const result = await service.resolveFault('user-3', 'fault-3', 'service done');

    expect(prisma.vehicleFault.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'fault-3' },
        data: expect.objectContaining({
          status: 'RESOLVED',
          resolvedBy: 'user-3',
        }),
      }),
    );
    expect(events.emit).toHaveBeenCalledWith(
      'vehicle.fault.resolved',
      expect.objectContaining({
        vehicleId: 'veh-3',
        faultId: 'fault-3',
        code: 'HV_ISOLATION',
      }),
    );
    expect(webhooks.dispatchEvent).toHaveBeenCalledWith(
      'vehicle.fault.resolved',
      expect.objectContaining({
        vehicleId: 'veh-3',
        faultId: 'fault-3',
        code: 'HV_ISOLATION',
      }),
      undefined,
    );
    expect(result).toEqual({
      ok: true,
      faultId: 'fault-3',
      status: 'RESOLVED',
      resolvedAt: resolvedAt.toISOString(),
    });
  });
});
