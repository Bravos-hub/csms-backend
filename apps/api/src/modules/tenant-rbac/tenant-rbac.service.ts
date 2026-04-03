import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CustomRoleStatus, MembershipStatus, Prisma } from '@prisma/client';
import {
  ALL_PERMISSION_CODES,
  CANONICAL_ROLE_KEYS,
  CANONICAL_ROLE_DEFINITIONS,
  getCanonicalRoleDefinition,
  isCanonicalRoleKey,
  isTenantScopedPermission,
  resolveRoleLabel,
  resolveStorageRole,
  type CanonicalRoleKey,
} from '@app/domain';
import { PrismaService } from '../../prisma.service';
import {
  AssignTenantMembershipDto,
  CreateTenantCustomRoleDto,
  UpdateTenantCustomRoleDto,
} from './dto/tenant-rbac.dto';

@Injectable()
export class TenantRbacService {
  constructor(private readonly prisma: PrismaService) {}

  listPermissionCatalog() {
    return ALL_PERMISSION_CODES.map((code) => ({
      code,
      scope: code.startsWith('platform.') ? 'PLATFORM' : 'TENANT',
      label: this.permissionLabel(code),
    }));
  }

  listSystemRoleTemplates() {
    return CANONICAL_ROLE_KEYS.map((roleKey) => {
      const definition = CANONICAL_ROLE_DEFINITIONS[roleKey];

      return {
        key: definition.key,
        label: definition.label,
        description: definition.description,
        family: definition.family,
        scopeType: definition.scopeType,
        permissionScope: definition.permissionScope,
        customizable: definition.customizable,
        defaultLegacyRole: definition.defaultLegacyRole,
        permissions: [...definition.permissions],
      };
    });
  }

  async listCustomRoles(organizationId: string) {
    const roles = await this.prisma.tenantCustomRole.findMany({
      where: { organizationId },
      include: {
        permissions: {
          orderBy: {
            permissionCode: 'asc',
          },
        },
      },
      orderBy: [{ status: 'asc' }, { name: 'asc' }],
    });

    return roles.map((role) => this.mapCustomRole(role));
  }

  async createCustomRole(
    organizationId: string,
    dto: CreateTenantCustomRoleDto,
    actorId: string,
  ) {
    const baseRoleKey = this.parseCanonicalRoleKey(dto.baseRoleKey);
    const definition = getCanonicalRoleDefinition(baseRoleKey);

    if (!definition?.customizable) {
      throw new BadRequestException(
        `Base role "${dto.baseRoleKey}" cannot be customized`,
      );
    }

    const permissions = this.validateTenantPermissionEnvelope(
      baseRoleKey,
      dto.permissions,
    );
    const key = this.normalizeCustomRoleKey(dto.key || dto.name);

    const created = await this.prisma.tenantCustomRole.create({
      data: {
        organizationId,
        key,
        name: dto.name.trim(),
        description: dto.description?.trim() || null,
        baseRoleKey,
        status: this.parseCustomRoleStatus(dto.status),
        createdBy: actorId,
        updatedBy: actorId,
        permissions: {
          create: permissions.map((permissionCode) => ({ permissionCode })),
        },
      },
      include: {
        permissions: {
          orderBy: {
            permissionCode: 'asc',
          },
        },
      },
    });

    return this.mapCustomRole(created);
  }

  async updateCustomRole(
    organizationId: string,
    customRoleId: string,
    dto: UpdateTenantCustomRoleDto,
    actorId: string,
  ) {
    const existing = await this.prisma.tenantCustomRole.findFirst({
      where: {
        id: customRoleId,
        organizationId,
      },
      include: {
        permissions: {
          orderBy: {
            permissionCode: 'asc',
          },
        },
      },
    });

    if (!existing) {
      throw new NotFoundException('Custom role not found');
    }

    const permissions =
      dto.permissions === undefined
        ? existing.permissions.map((permission) => permission.permissionCode)
        : this.validateTenantPermissionEnvelope(
            existing.baseRoleKey,
            dto.permissions,
          );

    const updated = await this.prisma.tenantCustomRole.update({
      where: { id: existing.id },
      data: {
        name: dto.name?.trim() || undefined,
        description:
          typeof dto.description === 'string'
            ? dto.description.trim() || null
            : undefined,
        status:
          dto.status === undefined
            ? undefined
            : this.parseCustomRoleStatus(dto.status),
        updatedBy: actorId,
        version: { increment: 1 },
        ...(dto.permissions !== undefined
          ? {
              permissions: {
                deleteMany: {},
                create: permissions.map((permissionCode) => ({
                  permissionCode,
                })),
              },
            }
          : {}),
      },
      include: {
        permissions: {
          orderBy: {
            permissionCode: 'asc',
          },
        },
      },
    });

    return this.mapCustomRole(updated);
  }

  async listMemberships(organizationId: string) {
    const controlPlane = this.prisma.getControlPlaneClient();
    const memberships = await controlPlane.organizationMembership.findMany({
      where: { organizationId },
      orderBy: [{ status: 'asc' }, { createdAt: 'asc' }],
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            status: true,
          },
        },
      },
    });

    return memberships.map((membership) => ({
      id: membership.id,
      userId: membership.userId,
      user: membership.user,
      tenantId: membership.organizationId,
      organizationId: membership.organizationId,
      roleKey: membership.canonicalRoleKey,
      roleLabel: resolveRoleLabel(
        membership.canonicalRoleKey || membership.role,
      ),
      legacyRole: membership.role,
      customRoleId: membership.customRoleId,
      customRoleName: membership.customRoleName,
      status: membership.status,
      createdAt: membership.createdAt,
      updatedAt: membership.updatedAt,
    }));
  }

  async assignMembership(
    organizationId: string,
    dto: AssignTenantMembershipDto,
    actorId: string,
  ) {
    const customRole = dto.customRoleId
      ? await this.prisma.tenantCustomRole.findFirst({
          where: {
            id: dto.customRoleId,
            organizationId,
          },
        })
      : null;

    if (dto.customRoleId && !customRole) {
      throw new NotFoundException('Custom role not found');
    }

    const roleKey = customRole
      ? customRole.baseRoleKey
      : this.parseCanonicalRoleKey(dto.roleKey);
    const storageRole = resolveStorageRole(roleKey);

    if (!storageRole) {
      throw new BadRequestException(`Unsupported role key "${roleKey}"`);
    }

    const controlPlane = this.prisma.getControlPlaneClient();

    await controlPlane.organizationMembership.upsert({
      where: {
        userId_organizationId: {
          userId: dto.userId,
          organizationId,
        },
      },
      create: {
        userId: dto.userId,
        organizationId,
        role: storageRole,
        canonicalRoleKey: roleKey,
        customRoleId: customRole?.id || null,
        customRoleName: customRole?.name || null,
        status: this.parseMembershipStatus(dto.status),
        invitedBy: actorId,
      },
      update: {
        role: storageRole,
        canonicalRoleKey: roleKey,
        customRoleId: customRole?.id || null,
        customRoleName: customRole?.name || null,
        status: this.parseMembershipStatus(dto.status),
        invitedBy: actorId,
      },
    });

    const tenantMembership = await this.prisma.tenantMembership.upsert({
      where: {
        userId_organizationId: {
          userId: dto.userId,
          organizationId,
        },
      },
      create: {
        organizationId,
        userId: dto.userId,
        roleKey,
        customRoleId: customRole?.id || null,
        status: this.parseMembershipStatus(dto.status),
        siteIds: dto.siteIds || [],
        stationIds: dto.stationIds || [],
        fleetGroupIds: dto.fleetGroupIds || [],
        createdBy: actorId,
        updatedBy: actorId,
      },
      update: {
        roleKey,
        customRoleId: customRole?.id || null,
        status: this.parseMembershipStatus(dto.status),
        siteIds: dto.siteIds || [],
        stationIds: dto.stationIds || [],
        fleetGroupIds: dto.fleetGroupIds || [],
        updatedBy: actorId,
      },
    });

    return {
      id: tenantMembership.id,
      userId: tenantMembership.userId,
      tenantId: tenantMembership.organizationId,
      organizationId: tenantMembership.organizationId,
      roleKey: tenantMembership.roleKey,
      roleLabel: resolveRoleLabel(tenantMembership.roleKey),
      customRoleId: tenantMembership.customRoleId,
      status: tenantMembership.status,
      siteIds: tenantMembership.siteIds,
      stationIds: tenantMembership.stationIds,
      fleetGroupIds: tenantMembership.fleetGroupIds,
    };
  }

  private mapCustomRole(
    role: Prisma.TenantCustomRoleGetPayload<{
      include: { permissions: true };
    }>,
  ) {
    return {
      id: role.id,
      key: role.key,
      tenantId: role.organizationId,
      organizationId: role.organizationId,
      name: role.name,
      description: role.description,
      baseRoleKey: role.baseRoleKey,
      baseRoleLabel: resolveRoleLabel(role.baseRoleKey),
      status: role.status,
      version: role.version,
      permissions: role.permissions.map(
        (permission) => permission.permissionCode,
      ),
      createdBy: role.createdBy,
      updatedBy: role.updatedBy,
      createdAt: role.createdAt,
      updatedAt: role.updatedAt,
    };
  }

  private parseCanonicalRoleKey(value?: string): CanonicalRoleKey {
    if (!value || !isCanonicalRoleKey(value)) {
      throw new BadRequestException(`Invalid canonical role key "${value}"`);
    }

    return value;
  }

  private parseCustomRoleStatus(value?: string): CustomRoleStatus {
    if (!value) {
      return CustomRoleStatus.ACTIVE;
    }

    if (!(value in CustomRoleStatus)) {
      throw new BadRequestException(`Invalid custom role status "${value}"`);
    }

    return value as CustomRoleStatus;
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

  private validateTenantPermissionEnvelope(
    baseRoleKey: CanonicalRoleKey,
    requestedPermissions: string[],
  ) {
    const definition = getCanonicalRoleDefinition(baseRoleKey);
    if (!definition) {
      throw new BadRequestException(`Unknown base role "${baseRoleKey}"`);
    }

    const allowedPermissions = new Set(definition.permissions);
    const normalizedPermissions = Array.from(
      new Set(
        requestedPermissions
          .map((permission) => permission.trim())
          .filter(Boolean),
      ),
    ).sort();

    for (const permission of normalizedPermissions) {
      if (!isTenantScopedPermission(permission)) {
        throw new BadRequestException(
          `Permission "${permission}" is not tenant scoped`,
        );
      }

      if (!allowedPermissions.has(permission)) {
        throw new BadRequestException(
          `Permission "${permission}" exceeds the "${baseRoleKey}" permission envelope`,
        );
      }
    }

    return normalizedPermissions;
  }

  private normalizeCustomRoleKey(value: string) {
    const normalized = value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');

    if (!normalized) {
      throw new BadRequestException('Custom role key could not be derived');
    }

    return normalized;
  }

  private permissionLabel(code: string) {
    return code
      .split('.')
      .map((segment) => segment.replace(/_/g, ' '))
      .join(' / ');
  }
}
