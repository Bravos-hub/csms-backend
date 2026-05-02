import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import { TenantContextService } from '@app/db';
import { PrismaService } from '../../prisma.service';
import { EventStreamService } from '../sse/sse.service';
import { WebhooksService } from '../webhooks/webhooks.service';

const PLATFORM_ADMIN_ROLES = new Set<UserRole>([
  UserRole.SUPER_ADMIN,
  UserRole.EVZONE_ADMIN,
]);

const WRITE_DENIED_TENANT_ROLE_KEYS = new Set(['FLEET_DRIVER']);

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function toInputJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? {})) as Prisma.InputJsonValue;
}

function mergeMetadata(
  existing: unknown,
  patch: Record<string, unknown>,
): Prisma.InputJsonValue {
  return toInputJsonValue({
    ...asRecord(existing),
    ...patch,
  });
}

@Injectable()
export class DiagnosticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly events: EventStreamService,
    private readonly webhooks: WebhooksService,
  ) {}

  async getFaults(userId: string, vehicleId: string) {
    const vehicle = await this.findAccessibleVehicle(vehicleId, userId, 'read');

    const faults = await this.prisma.vehicleFault.findMany({
      where: { vehicleId: vehicle.id, status: { in: ['OPEN', 'ACKNOWLEDGED'] } },
      orderBy: [{ severity: 'desc' }, { lastSeenAt: 'desc' }],
    });

    return faults.map((fault) => ({
      id: fault.id,
      vehicleId: fault.vehicleId,
      code: fault.code,
      severity: fault.severity,
      description: fault.description,
      timestamp: fault.lastSeenAt.toISOString(),
      status: fault.status,
      firstSeenAt: fault.firstSeenAt.toISOString(),
      acknowledgedAt: fault.acknowledgedAt?.toISOString() || null,
      resolvedAt: fault.resolvedAt?.toISOString() || null,
      recommendedAction: fault.recommendedAction,
    }));
  }

  async acknowledgeFault(userId: string, faultId: string, note?: string) {
    const fault = await this.findAccessibleFault(faultId, userId, 'write');

    const updated = await this.prisma.vehicleFault.update({
      where: { id: fault.id },
      data: {
        status: 'ACKNOWLEDGED',
        acknowledgedAt: new Date(),
        acknowledgedBy: userId,
        metadata: mergeMetadata(fault.metadata, {
          acknowledgeNote: note || null,
          acknowledgedAt: new Date().toISOString(),
        }),
      },
    });

    return {
      ok: true,
      faultId: updated.id,
      status: updated.status,
      acknowledgedAt: updated.acknowledgedAt?.toISOString() || null,
    };
  }

  async resolveFault(userId: string, faultId: string, note?: string) {
    const fault = await this.findAccessibleFault(faultId, userId, 'write');

    const updated = await this.prisma.vehicleFault.update({
      where: { id: fault.id },
      data: {
        status: 'RESOLVED',
        resolvedAt: new Date(),
        resolvedBy: userId,
        metadata: mergeMetadata(fault.metadata, {
          resolveNote: note || null,
          resolvedAt: new Date().toISOString(),
        }),
      },
    });

    await this.emitVehicleEvent(
      'vehicle.fault.resolved',
      {
        vehicleId: updated.vehicleId,
        faultId: updated.id,
        code: updated.code,
      },
      fault.vehicle.organizationId || undefined,
    );

    return {
      ok: true,
      faultId: updated.id,
      status: updated.status,
      resolvedAt: updated.resolvedAt?.toISOString() || null,
    };
  }

  private async findAccessibleFault(
    faultId: string,
    userId: string,
    mode: 'read' | 'write',
  ) {
    const fault = await this.prisma.vehicleFault.findUnique({
      where: { id: faultId },
      include: { vehicle: true },
    });
    if (!fault) {
      throw new NotFoundException('Fault not found');
    }

    await this.assertVehicleAccess(fault.vehicle, userId, mode);
    return fault;
  }

  private async findAccessibleVehicle(
    vehicleId: string,
    userId: string,
    mode: 'read' | 'write',
  ) {
    const vehicle = await this.prisma.vehicle.findUnique({ where: { id: vehicleId } });
    if (!vehicle) {
      throw new NotFoundException('Vehicle not found');
    }

    await this.assertVehicleAccess(vehicle, userId, mode);
    return vehicle;
  }

  private async assertVehicleAccess(
    vehicle: { userId: string; organizationId: string | null },
    userId: string,
    mode: 'read' | 'write',
  ) {
    if (vehicle.organizationId) {
      await this.assertTenantAccess(userId, vehicle.organizationId, mode);
      return;
    }

    if (vehicle.userId !== userId) {
      throw new ForbiddenException('Not your vehicle');
    }
  }

  private async assertTenantAccess(
    userId: string,
    organizationId: string,
    mode: 'read' | 'write',
  ) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });

    if (user?.role && PLATFORM_ADMIN_ROLES.has(user.role)) {
      return;
    }

    const membership = await this.prisma.tenantMembership.findFirst({
      where: { userId, organizationId, status: 'ACTIVE' },
      select: { roleKey: true },
    });

    if (!membership) {
      throw new ForbiddenException(
        'User must be an active tenant member for this vehicle scope',
      );
    }

    if (
      mode === 'write' &&
      membership.roleKey &&
      WRITE_DENIED_TENANT_ROLE_KEYS.has(membership.roleKey.toUpperCase())
    ) {
      throw new ForbiddenException(
        `Tenant role ${membership.roleKey} cannot modify fleet vehicles`,
      );
    }

    const tenantId = this.resolveTenantId();
    if (tenantId && tenantId !== organizationId) {
      throw new ForbiddenException('Active tenant context does not match vehicle tenant');
    }
  }

  private resolveTenantId(): string | null {
    const ctx = this.tenantContext.get();
    return ctx?.effectiveOrganizationId || ctx?.authenticatedOrganizationId || null;
  }

  private async emitVehicleEvent(
    eventType: string,
    payload: Record<string, unknown>,
    organizationId?: string,
  ) {
    this.events.emit(eventType, payload);
    await this.webhooks.dispatchEvent(eventType, payload, organizationId);
  }
}
