import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common'
import { Prisma, ProviderRelationshipStatus } from '@prisma/client'
import { PrismaService } from '../../prisma.service'
import { ProviderAuthzService } from './provider-authz.service'
import {
  CreateProviderRelationshipDto,
  ProviderNotesBodyDto,
  ProviderRelationshipsQueryDto,
  RespondProviderRelationshipDto,
  SuspendProviderRelationshipDto,
  TerminateProviderRelationshipDto,
} from './dto/providers.dto'
import { ProvidersService } from './providers.service'

type RelationshipWithRelations = Prisma.ProviderRelationshipGetPayload<{
  include: {
    provider: { select: { id: true; name: true } }
    ownerOrg: { select: { id: true; name: true } }
  }
}>

@Injectable()
export class ProviderRelationshipsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authz: ProviderAuthzService,
    private readonly providersService: ProvidersService,
  ) {}

  private mapRelationship(relationship: RelationshipWithRelations | Prisma.ProviderRelationshipGetPayload<Record<string, never>>) {
    const providerName = 'provider' in relationship ? relationship.provider?.name : undefined
    const ownerOrgName = 'ownerOrg' in relationship ? relationship.ownerOrg?.name : undefined
    return {
      id: relationship.id,
      providerId: relationship.providerId,
      providerName,
      ownerOrgId: relationship.ownerOrgId,
      ownerOrgName,
      status: relationship.status,
      createdAt: relationship.createdAt.toISOString(),
      updatedAt: relationship.updatedAt?.toISOString(),
      requestedBy: relationship.requestedBy || undefined,
      providerRespondedAt: relationship.providerRespondedAt?.toISOString(),
      adminApprovedAt: relationship.adminApprovedAt?.toISOString(),
      notes: relationship.notes || undefined,
    }
  }

  async listRelationships(query: ProviderRelationshipsQueryDto, actorId?: string) {
    const actor = await this.authz.getActor(actorId)
    const where: Prisma.ProviderRelationshipWhereInput = {}

    if (query.status) where.status = query.status

    if (query.ownerOrgId) {
      this.authz.assertOwnerOrgScope(actor, query.ownerOrgId)
      where.ownerOrgId = query.ownerOrgId
    }

    if (query.providerId) {
      if (this.authz.isProviderRole(actor.role)) {
        this.authz.assertProviderScope(actor, query.providerId)
      }
      where.providerId = query.providerId
    }

    if (query.my) {
      if (this.authz.isProviderRole(actor.role)) {
        where.providerId = actor.providerId || '__none__'
      } else if (this.authz.isOwnerRole(actor.role)) {
        if (!actor.organizationId) {
          throw new ForbiddenException('Authenticated owner user has no organizationId')
        }
        where.ownerOrgId = actor.organizationId
      }
    } else if (!this.authz.isPlatformOps(actor.role)) {
      if (this.authz.isProviderRole(actor.role)) {
        where.providerId = actor.providerId || '__none__'
      } else if (this.authz.isOwnerRole(actor.role)) {
        if (!actor.organizationId) {
          throw new ForbiddenException('Authenticated owner user has no organizationId')
        }
        where.ownerOrgId = actor.organizationId
      } else {
        throw new ForbiddenException('You do not have access to provider relationships')
      }
    }

    const relationships = await this.prisma.providerRelationship.findMany({
      where,
      include: {
        provider: { select: { id: true, name: true } },
        ownerOrg: { select: { id: true, name: true } },
      },
      orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
    })
    return relationships.map((relationship) => this.mapRelationship(relationship))
  }

  async requestRelationship(data: CreateProviderRelationshipDto, actorId?: string) {
    const actor = await this.authz.getActor(actorId)
    this.authz.assertOwnerOrgScope(actor, data.ownerOrgId)
    await this.providersService.ensureProviderApproved(data.providerId)

    const existingOpen = await this.prisma.providerRelationship.findFirst({
      where: {
        providerId: data.providerId,
        ownerOrgId: data.ownerOrgId,
        status: { not: ProviderRelationshipStatus.TERMINATED },
      },
      select: { id: true },
    })
    if (existingOpen) {
      throw new ConflictException('An active or pending relationship already exists for this owner/provider pair')
    }

    const relationship = await this.prisma.providerRelationship.create({
      data: {
        providerId: data.providerId,
        ownerOrgId: data.ownerOrgId,
        status: ProviderRelationshipStatus.REQUESTED,
        notes: data.notes,
        requestedBy: actor.id,
      },
      include: {
        provider: { select: { id: true, name: true } },
        ownerOrg: { select: { id: true, name: true } },
      },
    })

    return this.mapRelationship(relationship)
  }

  async respondToRelationship(id: string, body: RespondProviderRelationshipDto, actorId?: string) {
    const actor = await this.authz.getActor(actorId)

    const relationship = await this.prisma.providerRelationship.findUnique({
      where: { id },
      include: {
        provider: { select: { id: true, name: true } },
        ownerOrg: { select: { id: true, name: true } },
      },
    })
    if (!relationship) throw new NotFoundException('Relationship not found')
    this.authz.assertRelationshipScopedAccess(actor, relationship)

    if (relationship.status !== ProviderRelationshipStatus.REQUESTED) {
      throw new UnprocessableEntityException('Only REQUESTED relationships can be responded to')
    }

    const nextStatus =
      body.action === 'ACCEPT'
        ? ProviderRelationshipStatus.DOCS_PENDING
        : ProviderRelationshipStatus.TERMINATED

    const updated = await this.prisma.providerRelationship.update({
      where: { id },
      data: {
        status: nextStatus,
        notes: body.notes ?? relationship.notes,
        providerRespondedAt: new Date(),
      },
      include: {
        provider: { select: { id: true, name: true } },
        ownerOrg: { select: { id: true, name: true } },
      },
    })
    return this.mapRelationship(updated)
  }

  async approveRelationship(id: string, body: ProviderNotesBodyDto, actorId?: string) {
    const actor = await this.authz.getActor(actorId)
    this.authz.requirePlatformOps(actor)

    const relationship = await this.prisma.providerRelationship.findUnique({
      where: { id },
      include: {
        provider: { select: { id: true, name: true } },
        ownerOrg: { select: { id: true, name: true } },
      },
    })
    if (!relationship) throw new NotFoundException('Relationship not found')
    if (
      relationship.status !== ProviderRelationshipStatus.DOCS_PENDING &&
      relationship.status !== ProviderRelationshipStatus.ADMIN_APPROVED
    ) {
      throw new UnprocessableEntityException('Only DOCS_PENDING or ADMIN_APPROVED relationships can be approved')
    }

    const updated = await this.prisma.providerRelationship.update({
      where: { id },
      data: {
        status: ProviderRelationshipStatus.ACTIVE,
        adminApprovedAt: new Date(),
        notes: body.notes ?? relationship.notes,
      },
      include: {
        provider: { select: { id: true, name: true } },
        ownerOrg: { select: { id: true, name: true } },
      },
    })
    return this.mapRelationship(updated)
  }

  async suspendRelationship(id: string, body: SuspendProviderRelationshipDto, actorId?: string) {
    const actor = await this.authz.getActor(actorId)
    this.authz.requirePlatformOps(actor)

    const relationship = await this.prisma.providerRelationship.findUnique({
      where: { id },
      include: {
        provider: { select: { id: true, name: true } },
        ownerOrg: { select: { id: true, name: true } },
      },
    })
    if (!relationship) throw new NotFoundException('Relationship not found')
    if (relationship.status !== ProviderRelationshipStatus.ACTIVE) {
      throw new UnprocessableEntityException('Only ACTIVE relationships can be suspended')
    }

    const updated = await this.prisma.providerRelationship.update({
      where: { id },
      data: {
        status: ProviderRelationshipStatus.SUSPENDED,
        notes: body.reason ?? relationship.notes,
      },
      include: {
        provider: { select: { id: true, name: true } },
        ownerOrg: { select: { id: true, name: true } },
      },
    })
    return this.mapRelationship(updated)
  }

  async terminateRelationship(id: string, body: TerminateProviderRelationshipDto, actorId?: string) {
    const actor = await this.authz.getActor(actorId)

    const relationship = await this.prisma.providerRelationship.findUnique({
      where: { id },
      include: {
        provider: { select: { id: true, name: true } },
        ownerOrg: { select: { id: true, name: true } },
      },
    })
    if (!relationship) throw new NotFoundException('Relationship not found')

    this.authz.assertRelationshipScopedAccess(actor, relationship)

    if (relationship.status === ProviderRelationshipStatus.TERMINATED) {
      throw new UnprocessableEntityException('Relationship is already terminated')
    }

    const updated = await this.prisma.providerRelationship.update({
      where: { id },
      data: {
        status: ProviderRelationshipStatus.TERMINATED,
        notes: body.reason ?? relationship.notes,
      },
      include: {
        provider: { select: { id: true, name: true } },
        ownerOrg: { select: { id: true, name: true } },
      },
    })
    return this.mapRelationship(updated)
  }
}
