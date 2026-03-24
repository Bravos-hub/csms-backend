import { Injectable, Logger } from '@nestjs/common';
import { ZoneType } from '@prisma/client';
import { PrismaService } from '../../prisma.service';

export interface DeliveryContext {
  userId?: string;
  zoneId?: string | null;
  country?: string | null;
  region?: string | null;
}

type GeoBucket = 'china' | 'africa' | 'other' | 'unknown';
type SmsProviderRoute = 'submail' | 'africas_talking' | 'twilio';
type EmailProviderRoute = 'submail' | 'twilio_sendgrid';

interface SmsRouteResult {
  geoBucket: GeoBucket;
  primary: SmsProviderRoute;
  fallback?: SmsProviderRoute;
}

interface EmailRouteResult {
  geoBucket: GeoBucket;
  primary: EmailProviderRoute;
  fallback?: EmailProviderRoute;
}

@Injectable()
export class MessagingRoutingService {
  private readonly logger = new Logger(MessagingRoutingService.name);

  constructor(private readonly prisma: PrismaService) {}

  async resolveSmsRoute(input: {
    to: string;
    context?: DeliveryContext;
  }): Promise<SmsRouteResult> {
    const geoBucket = await this.resolveGeoBucket({
      channel: 'sms',
      recipient: input.to,
      context: input.context,
    });

    if (geoBucket === 'china') {
      return { geoBucket, primary: 'submail' };
    }

    if (geoBucket === 'africa') {
      return {
        geoBucket,
        primary: 'africas_talking',
        fallback: 'twilio',
      };
    }

    return {
      geoBucket,
      primary: 'twilio',
      fallback: 'submail',
    };
  }

  async resolveEmailRoute(input: {
    to: string;
    context?: DeliveryContext;
  }): Promise<EmailRouteResult> {
    const geoBucket = await this.resolveGeoBucket({
      channel: 'email',
      recipient: input.to,
      context: input.context,
    });

    if (geoBucket === 'china') {
      return { geoBucket, primary: 'submail' };
    }

    return {
      geoBucket,
      primary: 'twilio_sendgrid',
      fallback: 'submail',
    };
  }

  private async resolveGeoBucket(input: {
    channel: 'sms' | 'email';
    recipient: string;
    context?: DeliveryContext;
  }): Promise<GeoBucket> {
    const enriched = await this.enrichContext(
      input.channel,
      input.recipient,
      input.context,
    );

    if (enriched.zoneId) {
      const byZone = await this.resolveByZoneId(enriched.zoneId);
      if (byZone !== 'unknown') {
        return byZone;
      }
    }

    const byCountryOrRegion = await this.resolveByCountryOrRegion(
      enriched.country,
      enriched.region,
    );
    if (byCountryOrRegion !== 'unknown') {
      return byCountryOrRegion;
    }

    if (input.channel === 'sms' && this.isLikelyChinaPhone(input.recipient)) {
      return 'china';
    }

    return 'unknown';
  }

  private async enrichContext(
    channel: 'sms' | 'email',
    recipient: string,
    context?: DeliveryContext,
  ): Promise<DeliveryContext> {
    const merged: DeliveryContext = {
      userId: context?.userId,
      zoneId: context?.zoneId ?? null,
      country: context?.country ?? null,
      region: context?.region ?? null,
    };

    const hasGeo =
      Boolean(merged.zoneId) ||
      Boolean(merged.country) ||
      Boolean(merged.region);
    if (hasGeo) return merged;

    if (merged.userId) {
      const user = await this.prisma.user.findUnique({
        where: { id: merged.userId },
        select: {
          zoneId: true,
          country: true,
          region: true,
        },
      });
      if (user) {
        return {
          ...merged,
          zoneId: user.zoneId,
          country: user.country,
          region: user.region,
        };
      }
    }

    if (channel === 'email' && recipient.includes('@')) {
      const user = await this.prisma.user.findFirst({
        where: { email: { equals: recipient, mode: 'insensitive' } },
        select: {
          id: true,
          zoneId: true,
          country: true,
          region: true,
        },
      });
      if (user) {
        return {
          userId: user.id,
          zoneId: user.zoneId,
          country: user.country,
          region: user.region,
        };
      }
    }

    return merged;
  }

  private async resolveByCountryOrRegion(
    country?: string | null,
    region?: string | null,
  ): Promise<GeoBucket> {
    const candidates = [country, region]
      .map((value) => value?.trim())
      .filter((value): value is string => Boolean(value));

    for (const candidate of candidates) {
      const resolved = await this.resolveCandidateZone(candidate);
      if (resolved) {
        const byZone = await this.resolveByZoneId(resolved.id);
        if (byZone !== 'unknown') {
          return byZone;
        }
      }

      const token = this.normalizeToken(candidate);
      if (this.isChinaToken(token)) {
        return 'china';
      }
      if (this.isAfricaToken(token)) {
        return 'africa';
      }
    }

    return 'unknown';
  }

  private async resolveCandidateZone(candidate: string) {
    return this.prisma.geographicZone.findFirst({
      where: {
        isActive: true,
        OR: [
          { code: { equals: candidate, mode: 'insensitive' } },
          { name: { equals: candidate, mode: 'insensitive' } },
        ],
      },
      select: { id: true },
    });
  }

  private async resolveByZoneId(zoneId: string): Promise<GeoBucket> {
    let currentId: string | null = zoneId;
    let walked = 0;
    let sawKnownChain = false;

    while (currentId && walked < 8) {
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
        if (walked === 0) {
          this.logger.warn(`Routing zone not found: ${zoneId}`);
        }
        return sawKnownChain ? 'other' : 'unknown';
      }

      sawKnownChain = true;

      const codeToken = this.normalizeToken(zone.code);
      const nameToken = this.normalizeToken(zone.name);
      if (this.isChinaToken(codeToken) || this.isChinaToken(nameToken)) {
        return 'china';
      }
      if (this.isAfricaToken(codeToken) || this.isAfricaToken(nameToken)) {
        return 'africa';
      }

      if (!zone.parentId) {
        return 'other';
      }

      currentId = zone.parentId;
      walked += 1;
    }

    return sawKnownChain ? 'other' : 'unknown';
  }

  private isLikelyChinaPhone(value: string): boolean {
    const normalized = value.replace(/[^\d+]/g, '');
    if (normalized.startsWith('+86')) return true;
    if (normalized.startsWith('0086')) return true;
    return false;
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
      token === 'PRC' ||
      token === 'MAINLAND_CHINA' ||
      token === 'PEOPLES_REPUBLIC_OF_CHINA' ||
      token === 'PEOPLE_S_REPUBLIC_OF_CHINA'
    );
  }

  private isAfricaToken(token: string): boolean {
    return token === 'AF' || token === 'AFRICA' || token.includes('AFRICA');
  }
}
