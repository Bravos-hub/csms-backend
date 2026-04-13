import { Injectable } from '@nestjs/common';
import { ZoneType } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import { PaymentMarket } from './payment.types';

export interface PaymentMarketResolution {
  market: PaymentMarket;
  zoneId: string | null;
  country: string | null;
  region: string | null;
  reason: string;
}

@Injectable()
export class PaymentMarketResolverService {
  constructor(private readonly prisma: PrismaService) {}

  async resolveForUser(userId: string): Promise<PaymentMarketResolution> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        zoneId: true,
        country: true,
        region: true,
      },
    });

    return this.resolveFromInputs({
      zoneId: user?.zoneId || null,
      country: user?.country || null,
      region: user?.region || null,
      source: 'user_profile',
    });
  }

  async resolveForGuest(input: {
    zoneId?: string | null;
    country?: string | null;
    region?: string | null;
  }): Promise<PaymentMarketResolution> {
    return this.resolveFromInputs({
      zoneId: input.zoneId || null,
      country: input.country || null,
      region: input.region || null,
      source: 'guest_payload',
    });
  }

  private async resolveFromInputs(input: {
    zoneId: string | null;
    country: string | null;
    region: string | null;
    source: 'user_profile' | 'guest_payload';
  }): Promise<PaymentMarketResolution> {
    if (input.zoneId) {
      const zoneMarket = await this.resolveByZone(input.zoneId);
      if (zoneMarket) {
        return {
          market: zoneMarket,
          zoneId: input.zoneId,
          country: input.country,
          region: input.region,
          reason: `${input.source}:zone`,
        };
      }
    }

    const byCountry = this.resolveByToken(input.country);
    if (byCountry) {
      return {
        market: byCountry,
        zoneId: input.zoneId,
        country: input.country,
        region: input.region,
        reason: `${input.source}:country`,
      };
    }

    const byRegion = this.resolveByToken(input.region);
    if (byRegion) {
      return {
        market: byRegion,
        zoneId: input.zoneId,
        country: input.country,
        region: input.region,
        reason: `${input.source}:region`,
      };
    }

    return {
      market: 'GLOBAL',
      zoneId: input.zoneId,
      country: input.country,
      region: input.region,
      reason: `${input.source}:default_global`,
    };
  }

  private async resolveByZone(zoneId: string): Promise<PaymentMarket | null> {
    let currentId: string | null = zoneId;
    let depth = 0;

    while (currentId && depth < 8) {
      const zone: {
        id: string;
        code: string;
        name: string;
        type: ZoneType;
        parentId: string | null;
      } | null = await this.prisma.geographicZone.findUnique({
        where: { id: currentId },
        select: {
          id: true,
          code: true,
          name: true,
          type: true,
          parentId: true,
        },
      });

      if (!zone) {
        return null;
      }

      const byCode = this.resolveByToken(zone.code);
      if (byCode) {
        return byCode;
      }

      const byName = this.resolveByToken(zone.name);
      if (byName) {
        return byName;
      }

      currentId = zone.parentId;
      depth += 1;
    }

    return null;
  }

  private resolveByToken(
    value: string | null | undefined,
  ): PaymentMarket | null {
    if (!value) {
      return null;
    }

    const token = this.normalizeToken(value);
    if (this.isChinaToken(token)) {
      return 'CHINA';
    }

    return null;
  }

  private normalizeToken(value: string): string {
    return value
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
  }

  private isChinaToken(token: string): boolean {
    return (
      token === 'CN' ||
      token === 'CHN' ||
      token === 'CHINA' ||
      token === 'MAINLAND_CHINA' ||
      token === 'PEOPLES_REPUBLIC_OF_CHINA' ||
      token === 'PEOPLE_S_REPUBLIC_OF_CHINA' ||
      token === 'PRC'
    );
  }
}
