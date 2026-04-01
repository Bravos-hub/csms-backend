import { Injectable } from '@nestjs/common';
import { TenantRoutingHint } from '@app/db';
import { PrismaService } from '../../prisma.service';

@Injectable()
export class WorkerTenantRoutingService {
  constructor(private readonly prisma: PrismaService) {}

  async runWithTenant<T>(
    tenantId: string | null | undefined,
    operation: () => Promise<T>,
  ): Promise<T> {
    if (!tenantId) {
      return operation();
    }

    const organization = await this.prisma
      .getControlPlaneClient()
      .organization.findUnique({
        where: { id: tenantId },
        select: {
          id: true,
          tenantRoutingEnabled: true,
          tenantTier: true,
          tenantSchema: true,
        },
      });

    if (!organization) {
      return operation();
    }

    const routing: TenantRoutingHint = {
      organizationId: organization.id,
      routingEnabled: organization.tenantRoutingEnabled,
      tier: organization.tenantTier,
      schema: organization.tenantSchema,
    };

    return this.prisma.runWithTenantRouting(routing, operation);
  }
}
