import { Injectable } from '@nestjs/common';
import type { TenantTier } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import { TenantRoutingHint } from '@app/db';

export type TenantOrganizationRoutingRecord = {
  id: string;
  tenantSubdomain: string | null;
  primaryDomain: string | null;
  tenantRoutingEnabled: boolean;
  tenantTier: TenantTier;
  tenantSchema: string | null;
};

@Injectable()
export class TenantDirectoryService {
  constructor(private readonly prisma: PrismaService) {}

  async findBySubdomain(
    subdomain: string,
  ): Promise<TenantOrganizationRoutingRecord | null> {
    if (!subdomain) return null;

    return this.prisma.getControlPlaneClient().organization.findFirst({
      where: {
        tenantSubdomain: {
          equals: subdomain,
          mode: 'insensitive',
        },
      },
      select: {
        id: true,
        tenantSubdomain: true,
        primaryDomain: true,
        tenantRoutingEnabled: true,
        tenantTier: true,
        tenantSchema: true,
      },
    });
  }

  async findByPrimaryDomain(
    host: string,
  ): Promise<TenantOrganizationRoutingRecord | null> {
    if (!host) return null;

    return this.prisma.getControlPlaneClient().organization.findFirst({
      where: {
        primaryDomain: {
          equals: host,
          mode: 'insensitive',
        },
      },
      select: {
        id: true,
        tenantSubdomain: true,
        primaryDomain: true,
        tenantRoutingEnabled: true,
        tenantTier: true,
        tenantSchema: true,
      },
    });
  }

  async findByOrganizationId(
    organizationId: string,
  ): Promise<TenantOrganizationRoutingRecord | null> {
    if (!organizationId) return null;

    return this.prisma.getControlPlaneClient().organization.findUnique({
      where: { id: organizationId },
      select: {
        id: true,
        tenantSubdomain: true,
        primaryDomain: true,
        tenantRoutingEnabled: true,
        tenantTier: true,
        tenantSchema: true,
      },
    });
  }

  async findByHeaderTenant(
    tenantToken: string,
  ): Promise<TenantOrganizationRoutingRecord | null> {
    const normalized = tenantToken.trim();
    if (!normalized) return null;

    if (this.looksLikeUuid(normalized)) {
      const byId = await this.findByOrganizationId(normalized);
      if (byId) return byId;
    }

    return this.findBySubdomain(normalized.toLowerCase());
  }

  toRoutingHint(record: TenantOrganizationRoutingRecord): TenantRoutingHint {
    return {
      organizationId: record.id,
      routingEnabled: record.tenantRoutingEnabled,
      tier: record.tenantTier,
      schema: record.tenantSchema,
    };
  }

  private looksLikeUuid(value: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    );
  }
}
