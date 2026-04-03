import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { MembershipStatus } from '@prisma/client';
import {
  CANONICAL_ROLE_DEFINITIONS,
  CANONICAL_ROLE_KEYS,
  isCanonicalRoleKey,
} from '@app/domain';
import { PrismaService } from '../../prisma.service';
import { TenantProvisioningService } from '../tenant-provisioning/tenant-provisioning.service';
import {
  AssignPlatformRoleDto,
  CreatePlatformTenantDto,
  SuspendTenantDto,
  UpdatePlatformTenantDto,
} from '../tenant-provisioning/dto/tenant-provisioning.dto';

@Injectable()
export class PlatformService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantProvisioning: TenantProvisioningService,
  ) {}

  listTenants() {
    return this.tenantProvisioning.listTenants();
  }

  createTenant(dto: CreatePlatformTenantDto) {
    return this.tenantProvisioning.createTenant(dto);
  }

  updateTenant(id: string, dto: UpdatePlatformTenantDto) {
    return this.tenantProvisioning.updateTenant(id, dto);
  }

  suspendTenant(id: string, dto: SuspendTenantDto) {
    return this.tenantProvisioning.setTenantSuspended(id, dto.suspended);
  }

  listPlatformRoleTemplates() {
    return CANONICAL_ROLE_KEYS.filter(
      (roleKey) =>
        CANONICAL_ROLE_DEFINITIONS[roleKey].permissionScope === 'PLATFORM',
    ).map((roleKey) => {
      const definition = CANONICAL_ROLE_DEFINITIONS[roleKey];

      return {
        key: definition.key,
        label: definition.label,
        description: definition.description,
        permissions: [...definition.permissions],
      };
    });
  }

  async assignPlatformRole(
    userId: string,
    dto: AssignPlatformRoleDto,
    actorId: string,
  ) {
    if (!isCanonicalRoleKey(dto.roleKey)) {
      throw new BadRequestException(`Invalid canonical role "${dto.roleKey}"`);
    }

    const definition = CANONICAL_ROLE_DEFINITIONS[dto.roleKey];
    if (definition.permissionScope !== 'PLATFORM') {
      throw new BadRequestException(
        `Role "${dto.roleKey}" is not a platform-scoped role`,
      );
    }

    const user = await this.prisma.getControlPlaneClient().user.findUnique({
      where: { id: userId },
      select: { id: true },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return this.prisma.getControlPlaneClient().platformRoleAssignment.upsert({
      where: {
        userId_roleKey: {
          userId,
          roleKey: dto.roleKey,
        },
      },
      create: {
        userId,
        roleKey: dto.roleKey,
        status: this.parseMembershipStatus(dto.status),
        assignedBy: actorId,
      },
      update: {
        status: this.parseMembershipStatus(dto.status),
        assignedBy: actorId,
      },
    });
  }

  async getSystemHealth() {
    const controlPlane = this.prisma.getControlPlaneClient();

    const [tenantCount, activeTenantCount, userCount] = await Promise.all([
      controlPlane.organization.count(),
      controlPlane.organization.count({
        where: {
          suspendedAt: null,
        },
      }),
      controlPlane.user.count(),
    ]);

    return {
      tenants: {
        total: tenantCount,
        active: activeTenantCount,
      },
      users: {
        total: userCount,
      },
      routing: this.prisma.getRoutingMetrics(),
      pools: this.prisma.getPoolMetrics(),
    };
  }

  private parseMembershipStatus(value?: string): MembershipStatus {
    if (!value) {
      return MembershipStatus.ACTIVE;
    }

    if (!(value in MembershipStatus)) {
      throw new BadRequestException(`Invalid membership status "${value}"`);
    }

    return value as MembershipStatus;
  }
}
