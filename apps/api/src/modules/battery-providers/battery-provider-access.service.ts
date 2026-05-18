import { Injectable, ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import { BatteryProviderContextService } from '@app/db';

export interface ResolvedProviderScope {
  userId: string;
  tenantId: string;
  providerId: string;
  role: string;
  assignedStationIds: string[];
  assignedCabinetIds: string[];
}

@Injectable()
export class BatteryProviderAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly providerContext: BatteryProviderContextService,
  ) {}

  async resolveProviderScope(
    userId: string,
    tenantId: string,
  ): Promise<ResolvedProviderScope | null> {
    const userScope = await this.prisma.batteryProviderUserScope.findFirst({
      where: { userId, tenantId },
    });

    if (!userScope) {
      // Fall back to user.providerId if no explicit scope record exists
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { providerId: true, role: true },
      });

      if (!user?.providerId) {
        return null;
      }

      return {
        userId,
        tenantId,
        providerId: user.providerId,
        role: user.role,
        assignedStationIds: [],
        assignedCabinetIds: [],
      };
    }

    return {
      userId,
      tenantId,
      providerId: userScope.providerId,
      role: userScope.role,
      assignedStationIds: userScope.assignedStationIds,
      assignedCabinetIds: userScope.assignedCabinetIds,
    };
  }

  getCurrentScope(): ResolvedProviderScope | undefined {
    return this.providerContext.get();
  }

  assertProviderScope(scope: ResolvedProviderScope, providerId: string): void {
    if (scope.providerId !== providerId) {
      throw new ForbiddenException(
        'You do not have access to this battery provider scope',
      );
    }
  }

  assertStationAccess(scope: ResolvedProviderScope, stationId: string): void {
    if (
      scope.assignedStationIds.length > 0 &&
      !scope.assignedStationIds.includes(stationId)
    ) {
      throw new ForbiddenException('You do not have access to this station');
    }
  }

  assertCabinetAccess(scope: ResolvedProviderScope, cabinetId: string): void {
    if (
      scope.assignedCabinetIds.length > 0 &&
      !scope.assignedCabinetIds.includes(cabinetId)
    ) {
      throw new ForbiddenException('You do not have access to this cabinet');
    }
  }

  buildProviderStationWhere(
    scope: ResolvedProviderScope,
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

    if (scope.assignedStationIds.length > 0) {
      constraints.push({ id: { in: scope.assignedStationIds } });
    }

    if (extra) {
      constraints.push(extra);
    }

    return { AND: constraints };
  }

  buildProviderCabinetWhere(
    scope: ResolvedProviderScope,
    extra?: Prisma.BatteryCabinetWhereInput,
  ): Prisma.BatteryCabinetWhereInput {
    const constraints: Prisma.BatteryCabinetWhereInput[] = [
      { tenantId: scope.tenantId },
      { providerId: scope.providerId },
    ];

    if (scope.assignedStationIds.length > 0) {
      constraints.push({ stationId: { in: scope.assignedStationIds } });
    }

    if (scope.assignedCabinetIds.length > 0) {
      constraints.push({ id: { in: scope.assignedCabinetIds } });
    }

    if (extra) {
      constraints.push(extra);
    }

    return { AND: constraints };
  }

  buildProviderPackWhere(
    scope: ResolvedProviderScope,
    extra?: Prisma.BatteryPackWhereInput,
  ): Prisma.BatteryPackWhereInput {
    const constraints: Prisma.BatteryPackWhereInput[] = [
      { providerId: scope.providerId },
    ];

    if (scope.assignedStationIds.length > 0) {
      constraints.push({
        OR: [
          { stationId: { in: scope.assignedStationIds } },
          { stationId: null },
        ],
      });
    }

    if (scope.assignedCabinetIds.length > 0) {
      constraints.push({
        OR: [
          { cabinetId: { in: scope.assignedCabinetIds } },
          { cabinetId: null },
        ],
      });
    }

    if (extra) {
      constraints.push(extra);
    }

    return { AND: constraints };
  }

  buildProviderSwapWhere(
    scope: ResolvedProviderScope,
    extra?: Prisma.SwapSessionWhereInput,
  ): Prisma.SwapSessionWhereInput {
    const constraints: Prisma.SwapSessionWhereInput[] = [
      { tenantId: scope.tenantId },
      { providerId: scope.providerId },
    ];

    if (scope.assignedStationIds.length > 0) {
      constraints.push({ stationId: { in: scope.assignedStationIds } });
    }

    if (scope.assignedCabinetIds.length > 0) {
      constraints.push({ cabinetId: { in: scope.assignedCabinetIds } });
    }

    if (extra) {
      constraints.push(extra);
    }

    return { AND: constraints };
  }

  buildProviderAlertWhere(
    scope: ResolvedProviderScope,
    extra?: Prisma.BatteryProviderAlertWhereInput,
  ): Prisma.BatteryProviderAlertWhereInput {
    const constraints: Prisma.BatteryProviderAlertWhereInput[] = [
      { tenantId: scope.tenantId },
      { providerId: scope.providerId },
    ];

    if (extra) {
      constraints.push(extra);
    }

    return { AND: constraints };
  }
}
