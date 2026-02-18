import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common'
import {
  Prisma,
  ProviderRelationshipStatus,
  SwapProviderStatus,
} from '@prisma/client'
import { PrismaService } from '../../prisma.service'
import { ProviderAuthzService } from './provider-authz.service'
import {
  CreateProviderDto,
  ProviderListQueryDto,
  ProviderNotesBodyDto,
  ProviderRejectBodyDto,
  ProviderSuspendBodyDto,
  UpdateProviderDto,
} from './dto/providers.dto'

type ProviderWithRelations = Prisma.SwapProviderGetPayload<{
  include: {
    organization: { select: { id: true; name: true } }
  }
}>

@Injectable()
export class ProvidersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authz: ProviderAuthzService,
  ) {}

  private mapProvider(provider: ProviderWithRelations | Prisma.SwapProviderGetPayload<Record<string, never>>) {
    const partnerSince = provider.partnerSince instanceof Date ? provider.partnerSince.toISOString() : new Date().toISOString()
    return {
      ...provider,
      partnerSince,
      approvedAt: provider.approvedAt ? provider.approvedAt.toISOString() : null,
      suspendedAt: provider.suspendedAt ? provider.suspendedAt.toISOString() : null,
      createdAt: provider.createdAt.toISOString(),
      updatedAt: provider.updatedAt.toISOString(),
    }
  }

  async listProviders(query: ProviderListQueryDto, actorId?: string) {
    const actor = await this.authz.getActor(actorId)

    if (query.ownerOrgId && !this.authz.isPlatformOps(actor.role) && actor.organizationId !== query.ownerOrgId) {
      throw new ForbiddenException('ownerOrgId is outside your authenticated scope')
    }

    if (query.my && this.authz.isProviderRole(actor.role) && !actor.providerId) {
      return []
    }

    const where: Prisma.SwapProviderWhereInput = {}

    if (query.region) {
      where.region = { contains: query.region, mode: 'insensitive' }
    }
    if (query.standard) {
      where.standard = { equals: query.standard, mode: 'insensitive' }
    }
    if (query.status) {
      where.status = query.status
    }
    if (query.orgId) {
      where.organizationId = query.orgId
    }

    const relationshipOwnerOrgId =
      query.ownerOrgId ||
      (query.my && this.authz.isOwnerRole(actor.role) ? actor.organizationId || undefined : undefined)

    if (query.relationshipStatus || relationshipOwnerOrgId) {
      where.relationships = {
        some: {
          ...(relationshipOwnerOrgId ? { ownerOrgId: relationshipOwnerOrgId } : {}),
          ...(query.relationshipStatus ? { status: query.relationshipStatus } : {}),
        },
      }
    }

    if (query.my) {
      if (this.authz.isProviderRole(actor.role)) {
        where.id = actor.providerId || '__none__'
      } else if (this.authz.isOwnerRole(actor.role)) {
        if (!actor.organizationId) {
          throw new BadRequestException('Authenticated owner user has no organizationId')
        }
        where.relationships = {
          some: {
            ownerOrgId: actor.organizationId,
          },
        }
      }
    }

    if (query.includeOnlyEligible) {
      const ownerOrgId = this.authz.resolveOwnerOrgScope(actor, query.ownerOrgId || undefined)
      where.status = SwapProviderStatus.APPROVED
      where.NOT = {
        relationships: {
          some: {
            ownerOrgId,
            status: {
              not: ProviderRelationshipStatus.TERMINATED,
            },
          },
        },
      }
    }

    const providers = await this.prisma.swapProvider.findMany({
      where,
      include: {
        organization: { select: { id: true, name: true } },
      },
      orderBy: [{ status: 'asc' }, { name: 'asc' }],
    })
    return providers.map((provider) => this.mapProvider(provider))
  }

  async getProviderById(id: string, actorId?: string) {
    const actor = await this.authz.getActor(actorId)
    if (this.authz.isProviderRole(actor.role)) {
      this.authz.assertProviderScope(actor, id)
    }

    const provider = await this.prisma.swapProvider.findUnique({
      where: { id },
      include: {
        organization: { select: { id: true, name: true } },
      },
    })
    if (!provider) throw new NotFoundException('Provider not found')
    return this.mapProvider(provider)
  }

  async createProvider(data: CreateProviderDto, actorId?: string) {
    const actor = await this.authz.getActor(actorId)
    const isPlatformOps = this.authz.isPlatformOps(actor.role)
    const isProviderRole = this.authz.isProviderRole(actor.role)
    if (!isPlatformOps && !isProviderRole) {
      throw new ForbiddenException('Only platform ops or provider roles can create providers')
    }

    const organizationId = isPlatformOps ? data.organizationId : actor.organizationId
    if (!organizationId) {
      throw new BadRequestException('organizationId is required for provider creation')
    }

    const provider = await this.prisma.swapProvider.create({
      data: {
        name: data.name,
        logoUrl: data.logoUrl,
        legalName: data.legalName,
        registrationNumber: data.registrationNumber,
        taxId: data.taxId,
        contactEmail: data.contactEmail,
        contactPhone: data.contactPhone,
        region: data.region,
        regions: data.regions ?? [],
        countries: data.countries ?? [],
        organizationId,
        standard: data.standard,
        batteriesSupported: data.batteriesSupported ?? [],
        supportedStationTypes: data.supportedStationTypes ?? [],
        protocolCapabilities: data.protocolCapabilities ?? [],
        feeModel: data.feeModel,
        settlementTerms: data.settlementTerms,
        stationCount: data.stationCount ?? 0,
        website: data.website,
        requiredDocuments: data.requiredDocuments ?? [],
        partnerSince: data.partnerSince ? new Date(data.partnerSince) : new Date(),
        status: SwapProviderStatus.DRAFT,
      },
      include: {
        organization: { select: { id: true, name: true } },
      },
    })

    if (isProviderRole && !actor.providerId) {
      await this.prisma.user.update({
        where: { id: actor.id },
        data: { providerId: provider.id },
      })
    }

    return this.mapProvider(provider)
  }

  async updateProvider(id: string, data: UpdateProviderDto, actorId?: string) {
    const actor = await this.authz.getActor(actorId)
    const isPlatformOps = this.authz.isPlatformOps(actor.role)
    const isProviderRole = this.authz.isProviderRole(actor.role)
    if (!isPlatformOps && !isProviderRole) {
      throw new ForbiddenException('Only platform ops or provider roles can update providers')
    }
    if (isProviderRole) {
      this.authz.assertProviderScope(actor, id)
    }

    const existing = await this.prisma.swapProvider.findUnique({
      where: { id },
      select: { id: true, organizationId: true, status: true },
    })
    if (!existing) throw new NotFoundException('Provider not found')

    if (!isPlatformOps) {
      if (data.organizationId && data.organizationId !== existing.organizationId) {
        throw new ForbiddenException('Provider users cannot change provider organization')
      }
      if (existing.status === SwapProviderStatus.PENDING_REVIEW || existing.status === SwapProviderStatus.APPROVED) {
        throw new UnprocessableEntityException('Provider cannot be edited in current status')
      }
    }

    const provider = await this.prisma.swapProvider.update({
      where: { id },
      data: {
        name: data.name,
        logoUrl: data.logoUrl,
        legalName: data.legalName,
        registrationNumber: data.registrationNumber,
        taxId: data.taxId,
        contactEmail: data.contactEmail,
        contactPhone: data.contactPhone,
        region: data.region,
        regions: data.regions,
        countries: data.countries,
        organizationId: isPlatformOps ? data.organizationId : undefined,
        standard: data.standard,
        batteriesSupported: data.batteriesSupported,
        supportedStationTypes: data.supportedStationTypes,
        protocolCapabilities: data.protocolCapabilities,
        feeModel: data.feeModel,
        settlementTerms: data.settlementTerms,
        stationCount: data.stationCount,
        website: data.website,
        requiredDocuments: data.requiredDocuments,
      },
      include: {
        organization: { select: { id: true, name: true } },
      },
    })
    return this.mapProvider(provider)
  }

  async submitForReview(id: string, actorId?: string) {
    const actor = await this.authz.getActor(actorId)
    if (!this.authz.isPlatformOps(actor.role) && !this.authz.isProviderRole(actor.role)) {
      throw new ForbiddenException('Only platform ops or provider roles can submit provider for review')
    }
    if (this.authz.isProviderRole(actor.role)) {
      this.authz.assertProviderScope(actor, id)
    }

    const provider = await this.prisma.swapProvider.findUnique({ where: { id } })
    if (!provider) throw new NotFoundException('Provider not found')
    if (provider.status !== SwapProviderStatus.DRAFT) {
      throw new UnprocessableEntityException('Only DRAFT providers can be submitted for review')
    }

    const updated = await this.prisma.swapProvider.update({
      where: { id },
      data: { status: SwapProviderStatus.PENDING_REVIEW, statusReason: null },
      include: {
        organization: { select: { id: true, name: true } },
      },
    })
    return this.mapProvider(updated)
  }

  async approveProvider(id: string, body: ProviderNotesBodyDto, actorId?: string) {
    const actor = await this.authz.getActor(actorId)
    this.authz.requirePlatformOps(actor)

    const provider = await this.prisma.swapProvider.findUnique({ where: { id } })
    if (!provider) throw new NotFoundException('Provider not found')
    if (provider.status !== SwapProviderStatus.PENDING_REVIEW) {
      throw new UnprocessableEntityException('Only PENDING_REVIEW providers can be approved')
    }

    const updated = await this.prisma.swapProvider.update({
      where: { id },
      data: {
        status: SwapProviderStatus.APPROVED,
        approvedAt: new Date(),
        suspendedAt: null,
        statusReason: body.notes || null,
      },
      include: {
        organization: { select: { id: true, name: true } },
      },
    })
    return this.mapProvider(updated)
  }

  async rejectProvider(id: string, body: ProviderRejectBodyDto, actorId?: string) {
    const actor = await this.authz.getActor(actorId)
    this.authz.requirePlatformOps(actor)

    const provider = await this.prisma.swapProvider.findUnique({ where: { id } })
    if (!provider) throw new NotFoundException('Provider not found')
    if (provider.status !== SwapProviderStatus.PENDING_REVIEW) {
      throw new UnprocessableEntityException('Only PENDING_REVIEW providers can be rejected')
    }

    const updated = await this.prisma.swapProvider.update({
      where: { id },
      data: {
        status: SwapProviderStatus.REJECTED,
        statusReason: body.reason,
      },
      include: {
        organization: { select: { id: true, name: true } },
      },
    })
    return this.mapProvider(updated)
  }

  async suspendProvider(id: string, body: ProviderSuspendBodyDto, actorId?: string) {
    const actor = await this.authz.getActor(actorId)
    this.authz.requirePlatformOps(actor)

    const provider = await this.prisma.swapProvider.findUnique({ where: { id } })
    if (!provider) throw new NotFoundException('Provider not found')
    if (provider.status !== SwapProviderStatus.APPROVED) {
      throw new UnprocessableEntityException('Only APPROVED providers can be suspended')
    }

    const updated = await this.prisma.swapProvider.update({
      where: { id },
      data: {
        status: SwapProviderStatus.SUSPENDED,
        suspendedAt: new Date(),
        statusReason: body.reason || null,
      },
      include: {
        organization: { select: { id: true, name: true } },
      },
    })
    return this.mapProvider(updated)
  }

  async getEligibleForOwner(ownerOrgId: string | undefined, actorId?: string) {
    const actor = await this.authz.getActor(actorId)
    const scopedOwnerOrgId = this.authz.resolveOwnerOrgScope(actor, ownerOrgId)

    const providers = await this.prisma.swapProvider.findMany({
      where: {
        status: SwapProviderStatus.APPROVED,
        NOT: {
          relationships: {
            some: {
              ownerOrgId: scopedOwnerOrgId,
              status: { not: ProviderRelationshipStatus.TERMINATED },
            },
          },
        },
      },
      include: {
        organization: { select: { id: true, name: true } },
      },
      orderBy: { name: 'asc' },
    })
    return providers.map((provider) => this.mapProvider(provider))
  }

  async ensureProviderExists(providerId: string) {
    const provider = await this.prisma.swapProvider.findUnique({ where: { id: providerId } })
    if (!provider) throw new NotFoundException('Provider not found')
    return provider
  }

  async ensureProviderApproved(providerId: string) {
    const provider = await this.ensureProviderExists(providerId)
    if (provider.status !== SwapProviderStatus.APPROVED) {
      throw new ConflictException('Provider is not approved for this operation')
    }
    return provider
  }
}
