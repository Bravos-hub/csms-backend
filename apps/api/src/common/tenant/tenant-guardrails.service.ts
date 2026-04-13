import { ForbiddenException, Injectable } from '@nestjs/common';
import {
  CpoServiceType,
  Prisma,
  StationType,
  TenantOnboardingStage,
} from '@prisma/client';
import { TenantContextService } from '@app/db';
import { PrismaService } from '../../prisma.service';

export type TenantResourceDomain = 'tenant' | 'charge' | 'swap';

export type TenantScope = {
  tenantId: string;
  cpoType: CpoServiceType;
};

@Injectable()
export class TenantGuardrailsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async requireTenantScope(
    resource: TenantResourceDomain = 'tenant',
  ): Promise<TenantScope> {
    const context = this.tenantContext.get();
    const tenantId =
      context?.effectiveOrganizationId || context?.authenticatedOrganizationId;

    if (!tenantId) {
      throw new ForbiddenException('Active tenant context is required');
    }

    const cpoType = await this.resolveTenantCpoType(tenantId);
    if (!this.cpoTypeAllowsResource(cpoType, resource)) {
      throw new ForbiddenException(
        `Tenant CPO type "${cpoType}" cannot access ${resource} resources`,
      );
    }

    return { tenantId, cpoType };
  }

  buildOwnedStationWhere(
    scope: TenantScope,
    extra?: Prisma.StationWhereInput,
  ): Prisma.StationWhereInput {
    const constraints: Prisma.StationWhereInput[] = [
      {
        OR: [
          { orgId: scope.tenantId },
          { site: { organizationId: scope.tenantId } },
        ],
      },
    ];

    const cpoTypeConstraint = this.stationTypeConstraint(scope.cpoType);
    if (cpoTypeConstraint) {
      constraints.push(cpoTypeConstraint);
    }

    if (extra) {
      constraints.push(extra);
    }

    return { AND: constraints };
  }

  buildOwnedSiteWhere(
    scope: TenantScope,
    extra?: Prisma.SiteWhereInput,
  ): Prisma.SiteWhereInput {
    const constraints: Prisma.SiteWhereInput[] = [
      { organizationId: scope.tenantId },
    ];
    if (extra) {
      constraints.push(extra);
    }
    return { AND: constraints };
  }

  buildOwnedChargePointWhere(
    scope: TenantScope,
    extra?: Prisma.ChargePointWhereInput,
  ): Prisma.ChargePointWhereInput {
    const constraints: Prisma.ChargePointWhereInput[] = [
      {
        station: this.buildOwnedStationWhere(scope),
      },
    ];

    if (extra) {
      constraints.push(extra);
    }

    return { AND: constraints };
  }

  async listOwnedStationIds(
    scope: TenantScope,
    extra?: Prisma.StationWhereInput,
  ): Promise<string[]> {
    const stations = await this.prisma.station.findMany({
      where: this.buildOwnedStationWhere(scope, extra),
      select: { id: true },
    });
    return stations.map((station) => station.id);
  }

  isStationTypeAllowed(
    scope: TenantScope,
    stationType: StationType | null | undefined,
  ): boolean {
    if (!stationType) {
      return false;
    }

    if (scope.cpoType === CpoServiceType.HYBRID) {
      return (
        stationType === StationType.CHARGING ||
        stationType === StationType.SWAPPING
      );
    }

    if (scope.cpoType === CpoServiceType.CHARGE) {
      return stationType === StationType.CHARGING;
    }

    return stationType === StationType.SWAPPING;
  }

  private async resolveTenantCpoType(
    tenantId: string,
  ): Promise<CpoServiceType> {
    const application = await this.prisma
      .getControlPlaneClient()
      .tenantApplication.findFirst({
        where: {
          provisionedOrganizationId: tenantId,
          onboardingStage: TenantOnboardingStage.COMPLETED,
        },
        orderBy: [{ provisionedAt: 'desc' }, { updatedAt: 'desc' }],
        select: { cpoType: true },
      });

    if (!application) {
      throw new ForbiddenException(
        'Tenant CPO type is not configured for this organization',
      );
    }

    return application.cpoType;
  }

  private cpoTypeAllowsResource(
    cpoType: CpoServiceType,
    resource: TenantResourceDomain,
  ): boolean {
    if (resource === 'tenant') {
      return true;
    }

    if (cpoType === CpoServiceType.HYBRID) {
      return true;
    }

    if (resource === 'charge') {
      return cpoType === CpoServiceType.CHARGE;
    }

    return cpoType === CpoServiceType.SWAP;
  }

  private stationTypeConstraint(
    cpoType: CpoServiceType,
  ): Prisma.StationWhereInput | null {
    if (cpoType === CpoServiceType.HYBRID) {
      return null;
    }

    return {
      type:
        cpoType === CpoServiceType.CHARGE
          ? StationType.CHARGING
          : StationType.SWAPPING,
    };
  }
}
