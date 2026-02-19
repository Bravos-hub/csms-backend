import { Injectable, UnauthorizedException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../../prisma.service'
import { CreateMarketplaceContactEventDto } from './dto/marketplace-contacts.dto'

type RecentContactRow = {
  entityKind: string
  entityId: string
  entityName: string | null
  entityCity: string | null
  entityRegion: string | null
  lastEventType: string
  lastContactedAt: Date
}

@Injectable()
export class MarketplaceContactsService {
  constructor(private readonly prisma: PrismaService) {}

  async createEvent(actorId: string | undefined, data: CreateMarketplaceContactEventDto) {
    if (!actorId) {
      throw new UnauthorizedException('Missing authenticated user context')
    }

    const event = await this.prisma.marketplaceContactEvent.create({
      data: {
        actorId,
        entityKind: data.entityKind,
        entityId: data.entityId,
        eventType: data.eventType,
        entityName: data.entityName,
        entityCity: data.entityCity,
        entityRegion: data.entityRegion,
        metadata: data.metadata as Prisma.InputJsonValue | undefined,
      },
    })

    return {
      id: event.id,
      actorId: event.actorId,
      entityKind: event.entityKind,
      entityId: event.entityId,
      eventType: event.eventType,
      entityName: event.entityName || undefined,
      entityCity: event.entityCity || undefined,
      entityRegion: event.entityRegion || undefined,
      metadata: event.metadata || undefined,
      createdAt: event.createdAt.toISOString(),
    }
  }

  async getRecentContacts(actorId: string | undefined, limit?: number) {
    if (!actorId) {
      throw new UnauthorizedException('Missing authenticated user context')
    }

    const safeLimit = Math.min(Math.max(limit ?? 12, 1), 50)
    const rows = await this.prisma.$queryRaw<RecentContactRow[]>(Prisma.sql`
      SELECT
        ranked."entityKind",
        ranked."entityId",
        ranked."entityName",
        ranked."entityCity",
        ranked."entityRegion",
        ranked."eventType" AS "lastEventType",
        ranked."createdAt" AS "lastContactedAt"
      FROM (
        SELECT
          "entityKind",
          "entityId",
          "entityName",
          "entityCity",
          "entityRegion",
          "eventType",
          "createdAt",
          ROW_NUMBER() OVER (
            PARTITION BY "entityKind", "entityId"
            ORDER BY "createdAt" DESC
          ) AS rn
        FROM "marketplace_contact_events"
        WHERE "actorId" = ${actorId}
      ) ranked
      WHERE ranked.rn = 1
      ORDER BY "lastContactedAt" DESC
      LIMIT ${safeLimit}
    `)

    return rows.map((row) => ({
      entityKind: row.entityKind,
      entityId: row.entityId,
      entityName: row.entityName || undefined,
      entityCity: row.entityCity || undefined,
      entityRegion: row.entityRegion || undefined,
      lastEventType: row.lastEventType,
      lastContactedAt: row.lastContactedAt.toISOString(),
    }))
  }
}
