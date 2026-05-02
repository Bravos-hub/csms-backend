import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import { TenantContextService } from '@app/db';
import { PrismaService } from '../../prisma.service';
import { MediaStorageService } from '../../common/services/media-storage.service';
import { CreateVehicleDto, UpdateVehicleDto } from './vehicles.dto';

const WRITE_DENIED_TENANT_ROLE_KEYS = new Set(['FLEET_DRIVER']);
const PLATFORM_ADMIN_ROLES = new Set<UserRole>([
  UserRole.SUPER_ADMIN,
  UserRole.EVZONE_ADMIN,
]);

@Injectable()
export class VehiclesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly mediaStorage: MediaStorageService,
  ) {}

  // ─── List ──────────────────────────────────────────────────────────────────

  async list(userId: string, scope: 'personal' | 'tenant' | 'all' = 'all') {
    const tenantId = this.resolveTenantId();
    const clauses: Prisma.VehicleWhereInput[] = [];

    if (scope === 'personal' || scope === 'all') {
      clauses.push({ userId });
    }
    if ((scope === 'tenant' || scope === 'all') && tenantId) {
      await this.assertTenantAccess(userId, tenantId, 'read');
      clauses.push({ organizationId: tenantId });
    }
    if (!clauses.length) {
      return [];
    }

    return this.prisma.vehicle.findMany({
      where: { OR: clauses },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ─── Create ────────────────────────────────────────────────────────────────

  async create(userId: string, dto: CreateVehicleDto) {
    const tenantId = this.resolveTenantId();
    const isTenantScoped =
      Boolean(dto.organizationId) ||
      Boolean(dto.fleetAccountId) ||
      Boolean(dto.fleetDriverId) ||
      Boolean(dto.fleetDriverGroupId) ||
      dto.ownershipType === 'ORGANIZATION' ||
      dto.ownershipType === 'FLEET';

    const organizationId = isTenantScoped
      ? dto.organizationId || tenantId
      : null;

    if (isTenantScoped && !organizationId) {
      throw new ForbiddenException(
        'Organization context is required for fleet-scoped vehicles',
      );
    }

    if (organizationId) {
      await this.assertTenantAccess(userId, organizationId, 'write');
    }

    return this.prisma.vehicle.create({
      data: {
        ...dto,
        connectors: dto.connectors ?? [],
        userId,
        ownershipType:
          dto.ownershipType ??
          (organizationId
            ? dto.fleetAccountId
              ? 'FLEET'
              : 'ORGANIZATION'
            : 'PERSONAL'),
        organizationId,
        vehicleStatus: dto.vehicleStatus ?? 'ACTIVE',
        telemetryProvider: dto.telemetryProvider ?? 'MOCK',
      },
    });
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  private resolveTenantId(): string | null {
    const context = this.tenantContext.get();
    return (
      context?.effectiveOrganizationId ||
      context?.authenticatedOrganizationId ||
      null
    );
  }

  private async assertTenantAccess(
    userId: string,
    organizationId: string,
    mode: 'read' | 'write',
  ): Promise<void> {
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
  }

  /** Fetch and assert the caller can access the vehicle. */
  private async findAccessible(
    vehicleId: string,
    userId: string,
    mode: 'read' | 'write',
  ) {
    const vehicle = await this.prisma.vehicle.findUnique({
      where: { id: vehicleId },
    });
    if (!vehicle) throw new NotFoundException('Vehicle not found');

    if (vehicle.organizationId) {
      await this.assertTenantAccess(userId, vehicle.organizationId, mode);
      return vehicle;
    }

    if (vehicle.userId !== userId) {
      throw new ForbiddenException('Not your vehicle');
    }

    return vehicle;
  }

  // ─── Update ────────────────────────────────────────────────────────────────

  async update(vehicleId: string, userId: string, dto: UpdateVehicleDto) {
    const existing = await this.findAccessible(vehicleId, userId, 'write');

    const targetOrganizationId = dto.organizationId ?? existing.organizationId;
    if (targetOrganizationId) {
      await this.assertTenantAccess(userId, targetOrganizationId, 'write');
    }

    return this.prisma.vehicle.update({
      where: { id: vehicleId },
      data: {
        ...dto,
        ownershipType:
          dto.ownershipType ??
          (targetOrganizationId
            ? dto.fleetAccountId || existing.fleetAccountId
              ? 'FLEET'
              : existing.ownershipType || 'ORGANIZATION'
            : existing.ownershipType || 'PERSONAL'),
      },
    });
  }

  // ─── Delete ────────────────────────────────────────────────────────────────

  async remove(vehicleId: string, userId: string) {
    const vehicle = await this.findAccessible(vehicleId, userId, 'write');

    // Clean up Cloudinary photo if present
    if (vehicle.cloudinaryPublicId) {
      await this.mediaStorage
        .delete(vehicle.cloudinaryPublicId)
        .catch(() => null);
    }

    await this.prisma.vehicle.delete({ where: { id: vehicleId } });
    return { ok: true };
  }

  // ─── Active vehicle ────────────────────────────────────────────────────────

  async getActive(userId: string) {
    // Active selection remains user-specific for backward compatibility.
    return this.prisma.vehicle.findFirst({
      where: { userId, isActive: true },
    });
  }

  async setActive(userId: string, vehicleId: string | null) {
    // Clear all active flags for this user first
    await this.prisma.vehicle.updateMany({
      where: { userId },
      data: { isActive: false },
    });

    if (vehicleId) {
      const vehicle = await this.findAccessible(vehicleId, userId, 'write');
      if (vehicle.organizationId) {
        throw new BadRequestException(
          'Active vehicle selection only supports personal vehicles',
        );
      }

      await this.prisma.vehicle.update({
        where: { id: vehicleId },
        data: { isActive: true },
      });
    }

    return { activeVehicleId: vehicleId };
  }

  // ─── Photo upload ──────────────────────────────────────────────────────────

  async uploadPhoto(
    vehicleId: string,
    userId: string,
    file: Express.Multer.File,
  ) {
    const vehicle = await this.findAccessible(vehicleId, userId, 'write');
    if (!file) throw new BadRequestException('File is required');

    // Delete old photo from Cloudinary if it exists
    if (vehicle.cloudinaryPublicId) {
      await this.mediaStorage
        .delete(vehicle.cloudinaryPublicId)
        .catch(() => null);
    }

    // Upload new photo
    const result = await this.mediaStorage.uploadBuffer({
      buffer: file.buffer,
      folder: `evzone-vehicles/${vehicle.organizationId || userId}`,
      resourceType: 'image',
      context: `vehicleId=${vehicleId}|userId=${userId}`,
    });

    return this.prisma.vehicle.update({
      where: { id: vehicleId },
      data: {
        photoUrl: result.url,
        cloudinaryPublicId: result.publicId,
      },
    });
  }
}
