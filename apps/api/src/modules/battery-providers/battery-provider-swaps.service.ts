import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, SwapSessionStage } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import {
  BatteryProviderAccessService,
  ResolvedProviderScope,
} from './battery-provider-access.service';

@Injectable()
export class BatteryProviderSwapsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accessService: BatteryProviderAccessService,
  ) {}

  async listSwaps(
    scope: ResolvedProviderScope,
    filters: {
      stationId?: string;
      cabinetId?: string;
      stage?: string;
      dateFrom?: Date;
      dateTo?: Date;
      failedOnly?: boolean;
      page?: number;
      limit?: number;
    },
  ) {
    const where = this.accessService.buildProviderSwapWhere(scope);
    const conditions: Prisma.SwapSessionWhereInput[] = [where];

    if (filters.stationId) {
      conditions.push({ stationId: filters.stationId });
    }
    if (filters.cabinetId) {
      conditions.push({ cabinetId: filters.cabinetId });
    }
    if (filters.stage) {
      conditions.push({ stage: filters.stage as SwapSessionStage });
    }
    if (filters.dateFrom || filters.dateTo) {
      conditions.push({
        startedAt: {
          gte: filters.dateFrom,
          lte: filters.dateTo,
        },
      });
    }
    if (filters.failedOnly) {
      conditions.push({ stage: 'FAILED' });
    }

    const finalWhere: Prisma.SwapSessionWhereInput =
      conditions.length > 1 ? { AND: conditions } : conditions[0];

    const page = filters.page ?? 1;
    const limit = Math.min(filters.limit ?? 25, 100);
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      this.prisma.swapSession.findMany({
        where: finalWhere,
        orderBy: { startedAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.swapSession.count({ where: finalWhere }),
    ]);

    return { items, total, page, limit };
  }

  async getSwapDetail(scope: ResolvedProviderScope, swapSessionId: string) {
    const swap = await this.prisma.swapSession.findFirst({
      where: this.accessService.buildProviderSwapWhere(scope, {
        id: swapSessionId,
      }),
    });

    if (!swap) {
      throw new NotFoundException('Swap session not found');
    }

    return swap;
  }

  async getSwapTechnicalEvents(
    scope: ResolvedProviderScope,
    swapSessionId: string,
    limit = 50,
  ) {
    const swap = await this.getSwapDetail(scope, swapSessionId);

    return this.prisma.mqttVendorPayloadLog.findMany({
      where: {
        normalizedEventType: 'SESSION_UPDATE',
        payload: {
          path: ['swapSessionId'],
          equals: swap.sessionId,
        },
        tenantId: scope.tenantId,
      },
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, 100),
    });
  }
}
