import { BadRequestException, Injectable } from '@nestjs/common';
import type { Prisma, TenantTier } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import {
  CreatePlatformTenantDto,
  UpdatePlatformTenantDto,
} from './dto/tenant-provisioning.dto';

@Injectable()
export class TenantProvisioningService {
  constructor(private readonly prisma: PrismaService) {}

  async listTenants() {
    return this.prisma.getControlPlaneClient().organization.findMany({
      orderBy: [{ suspendedAt: 'asc' }, { name: 'asc' }],
    });
  }

  async createTenant(dto: CreatePlatformTenantDto) {
    return this.prisma.getControlPlaneClient().organization.create({
      data: this.toOrganizationCreateInput(dto),
    });
  }

  async updateTenant(id: string, dto: UpdatePlatformTenantDto) {
    return this.prisma.getControlPlaneClient().organization.update({
      where: { id },
      data: this.toOrganizationUpdateInput(dto),
    });
  }

  async setTenantSuspended(id: string, suspended: boolean) {
    return this.prisma.getControlPlaneClient().organization.update({
      where: { id },
      data: {
        suspendedAt: suspended ? new Date() : null,
      },
    });
  }

  private toOrganizationCreateInput(
    dto: CreatePlatformTenantDto,
  ): Prisma.OrganizationCreateInput {
    return {
      name: dto.name.trim(),
      description: dto.description?.trim() || null,
      type: dto.type?.trim() || 'COMPANY',
      tenantSubdomain: dto.tenantSubdomain?.trim() || null,
      tenantTier: this.parseTenantTier(dto.tenantTier),
      tenantSchema: dto.tenantSchema?.trim() || null,
      tenantRoutingEnabled: Boolean(dto.tenantRoutingEnabled),
      primaryDomain: dto.primaryDomain?.trim() || null,
      allowedOrigins: dto.allowedOrigins || [],
      whiteLabelConfig:
        (dto.whiteLabelConfig as Prisma.InputJsonValue | undefined) ||
        undefined,
      billingPlanCode: dto.billingPlanCode?.trim() || null,
      billingStatus: dto.billingStatus?.trim() || null,
    };
  }

  private toOrganizationUpdateInput(
    dto: UpdatePlatformTenantDto,
  ): Prisma.OrganizationUpdateInput {
    return {
      ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
      ...(dto.description !== undefined
        ? { description: dto.description.trim() || null }
        : {}),
      ...(dto.type !== undefined ? { type: dto.type.trim() || 'COMPANY' } : {}),
      ...(dto.tenantSubdomain !== undefined
        ? { tenantSubdomain: dto.tenantSubdomain.trim() || null }
        : {}),
      ...(dto.tenantTier !== undefined
        ? { tenantTier: this.parseTenantTier(dto.tenantTier) }
        : {}),
      ...(dto.tenantSchema !== undefined
        ? { tenantSchema: dto.tenantSchema.trim() || null }
        : {}),
      ...(dto.tenantRoutingEnabled !== undefined
        ? { tenantRoutingEnabled: dto.tenantRoutingEnabled }
        : {}),
      ...(dto.primaryDomain !== undefined
        ? { primaryDomain: dto.primaryDomain.trim() || null }
        : {}),
      ...(dto.allowedOrigins !== undefined
        ? { allowedOrigins: dto.allowedOrigins }
        : {}),
      ...(dto.whiteLabelConfig !== undefined
        ? {
            whiteLabelConfig:
              dto.whiteLabelConfig as unknown as Prisma.InputJsonValue,
          }
        : {}),
      ...(dto.billingPlanCode !== undefined
        ? { billingPlanCode: dto.billingPlanCode.trim() || null }
        : {}),
      ...(dto.billingStatus !== undefined
        ? { billingStatus: dto.billingStatus.trim() || null }
        : {}),
    };
  }

  private parseTenantTier(value?: string): TenantTier {
    if (!value) {
      return 'SHARED' as TenantTier;
    }

    if (!['SHARED', 'SCHEMA', 'DEDICATED_DB'].includes(value)) {
      throw new BadRequestException(`Invalid tenant tier "${value}"`);
    }

    return value as TenantTier;
  }
}
