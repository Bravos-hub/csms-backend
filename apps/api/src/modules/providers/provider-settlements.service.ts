import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common'
import { Prisma, ProviderSettlementStatus } from '@prisma/client'
import { PrismaService } from '../../prisma.service'
import { ProviderAuthzService } from './provider-authz.service'
import {
  CreateProviderSettlementEntryDto,
  ProviderSettlementSummaryQueryDto,
} from './dto/providers.dto'

@Injectable()
export class ProviderSettlementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authz: ProviderAuthzService,
  ) {}

  private sumBy<T>(entries: T[], select: (row: T) => number): number {
    return Number(entries.reduce((acc, row) => acc + (select(row) || 0), 0).toFixed(2))
  }

  async getSummary(query: ProviderSettlementSummaryQueryDto, actorId?: string) {
    const actor = await this.authz.getActor(actorId)
    const where: Prisma.ProviderSettlementEntryWhereInput = {}

    if (query.providerId) where.providerId = query.providerId
    if (query.ownerOrgId) where.ownerOrgId = query.ownerOrgId

    if (query.startDate || query.endDate) {
      where.createdAt = {
        ...(query.startDate ? { gte: new Date(query.startDate) } : {}),
        ...(query.endDate ? { lte: new Date(query.endDate) } : {}),
      }
    }

    if (query.my) {
      if (this.authz.isProviderRole(actor.role)) {
        if (!actor.providerId) throw new ForbiddenException('Provider user has no providerId scope')
        where.providerId = actor.providerId
      } else if (this.authz.isOwnerRole(actor.role)) {
        if (!actor.organizationId) throw new ForbiddenException('Owner user has no organizationId scope')
        where.ownerOrgId = actor.organizationId
      }
    } else if (!this.authz.isPlatformOps(actor.role)) {
      if (this.authz.isProviderRole(actor.role)) {
        if (!actor.providerId) throw new ForbiddenException('Provider user has no providerId scope')
        if (query.providerId && query.providerId !== actor.providerId) {
          throw new ForbiddenException('providerId is outside your authenticated scope')
        }
        where.providerId = actor.providerId
      } else if (this.authz.isOwnerRole(actor.role)) {
        if (!actor.organizationId) throw new ForbiddenException('Owner user has no organizationId scope')
        if (query.ownerOrgId && query.ownerOrgId !== actor.organizationId) {
          throw new ForbiddenException('ownerOrgId is outside your authenticated scope')
        }
        where.ownerOrgId = actor.organizationId
      } else {
        throw new ForbiddenException('You do not have access to provider settlements')
      }
    }

    const rows = await this.prisma.providerSettlementEntry.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    })

    const gross = this.sumBy(rows, (row) => row.amount)
    const providerFee = this.sumBy(rows, (row) => row.providerFee)
    const platformFee = this.sumBy(rows, (row) => row.platformFee)
    const adjustments = this.sumBy(rows, (row) => row.adjustment)
    const receivables = this.sumBy(rows, (row) => row.net)
    const paid = Number(
      rows
        .filter((row) => row.status === ProviderSettlementStatus.PAID)
        .reduce((acc, row) => acc + row.net, 0)
        .toFixed(2),
    )
    const pending = Number(
      rows
        .filter((row) => row.status === ProviderSettlementStatus.PENDING)
        .reduce((acc, row) => acc + row.net, 0)
        .toFixed(2),
    )
    const netPayable = Number((receivables - paid).toFixed(2))

    return {
      currency: rows[0]?.currency || 'USD',
      period:
        query.startDate || query.endDate
          ? {
              start: query.startDate || rows[rows.length - 1]?.createdAt.toISOString() || new Date().toISOString(),
              end: query.endDate || rows[0]?.createdAt.toISOString() || new Date().toISOString(),
            }
          : undefined,
      totals: {
        gross,
        providerFee,
        platformFee,
        adjustments,
        receivables,
        paid,
        pending,
        netPayable,
      },
      rows: rows.map((row) => ({
        id: row.id,
        relationshipId: row.relationshipId || undefined,
        providerId: row.providerId,
        ownerOrgId: row.ownerOrgId || undefined,
        stationId: row.stationId || undefined,
        sessionId: row.sessionId || undefined,
        amount: row.amount,
        providerFee: row.providerFee,
        platformFee: row.platformFee,
        adjustment: row.adjustment,
        net: row.net,
        status: row.status,
        createdAt: row.createdAt.toISOString(),
      })),
    }
  }

  async createEntry(data: CreateProviderSettlementEntryDto, actorId?: string) {
    const actor = await this.authz.getActor(actorId)
    this.authz.requirePlatformOps(actor)

    if (data.relationshipId) {
      const relationship = await this.prisma.providerRelationship.findUnique({
        where: { id: data.relationshipId },
        select: { id: true, providerId: true, ownerOrgId: true },
      })
      if (!relationship) {
        throw new BadRequestException('relationshipId is invalid')
      }
      if (relationship.providerId !== data.providerId) {
        throw new BadRequestException('relationshipId providerId does not match payload providerId')
      }
      if (data.ownerOrgId && relationship.ownerOrgId !== data.ownerOrgId) {
        throw new BadRequestException('relationshipId ownerOrgId does not match payload ownerOrgId')
      }
    }

    const entry = await this.prisma.providerSettlementEntry.create({
      data: {
        relationshipId: data.relationshipId,
        providerId: data.providerId,
        ownerOrgId: data.ownerOrgId,
        stationId: data.stationId,
        sessionId: data.sessionId,
        amount: data.amount,
        providerFee: data.providerFee,
        platformFee: data.platformFee,
        adjustment: data.adjustment ?? 0,
        net: data.net,
        currency: data.currency || 'USD',
        status: data.status || ProviderSettlementStatus.PENDING,
      },
    })

    return {
      id: entry.id,
      relationshipId: entry.relationshipId || undefined,
      providerId: entry.providerId,
      ownerOrgId: entry.ownerOrgId || undefined,
      stationId: entry.stationId || undefined,
      sessionId: entry.sessionId || undefined,
      amount: entry.amount,
      providerFee: entry.providerFee,
      platformFee: entry.platformFee,
      adjustment: entry.adjustment,
      net: entry.net,
      status: entry.status,
      createdAt: entry.createdAt.toISOString(),
    }
  }
}
