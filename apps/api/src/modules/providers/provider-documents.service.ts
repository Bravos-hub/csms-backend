import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { Prisma, ProviderDocumentStatus } from '@prisma/client'
import { PrismaService } from '../../prisma.service'
import { ProviderAuthzService } from './provider-authz.service'
import {
  CreateProviderDocumentDto,
  ProviderDocumentsQueryDto,
} from './dto/providers.dto'

type ProviderDocumentWithRelationship = Prisma.ProviderDocumentGetPayload<{
  include: {
    relationship: { select: { id: true; ownerOrgId: true; providerId: true } }
  }
}>

@Injectable()
export class ProviderDocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authz: ProviderAuthzService,
  ) {}

  private mapDocument(document: ProviderDocumentWithRelationship | Prisma.ProviderDocumentGetPayload<Record<string, never>>) {
    return {
      id: document.id,
      providerId: document.providerId || undefined,
      relationshipId: document.relationshipId || undefined,
      ownerOrgId: document.ownerOrgId || undefined,
      type: document.type,
      name: document.name,
      fileUrl: document.fileUrl,
      uploadedAt: document.uploadedAt.toISOString(),
      uploadedBy: document.uploadedBy || undefined,
      status: document.status,
      rejectionReason: document.rejectionReason || undefined,
    }
  }

  async listDocuments(query: ProviderDocumentsQueryDto, actorId?: string) {
    const actor = await this.authz.getActor(actorId)
    const where: Prisma.ProviderDocumentWhereInput = {}

    if (query.providerId) where.providerId = query.providerId
    if (query.relationshipId) where.relationshipId = query.relationshipId

    if (query.my) {
      if (this.authz.isProviderRole(actor.role)) {
        where.providerId = actor.providerId || '__none__'
      } else if (this.authz.isOwnerRole(actor.role)) {
        if (!actor.organizationId) throw new ForbiddenException('Authenticated owner user has no organizationId')
        where.OR = [
          { ownerOrgId: actor.organizationId },
          { relationship: { ownerOrgId: actor.organizationId } },
        ]
      }
    } else if (!this.authz.isPlatformOps(actor.role)) {
      if (this.authz.isProviderRole(actor.role)) {
        where.providerId = actor.providerId || '__none__'
      } else if (this.authz.isOwnerRole(actor.role)) {
        if (!actor.organizationId) throw new ForbiddenException('Authenticated owner user has no organizationId')
        where.OR = [
          { ownerOrgId: actor.organizationId },
          { relationship: { ownerOrgId: actor.organizationId } },
        ]
      } else {
        throw new ForbiddenException('You do not have access to provider documents')
      }
    }

    const docs = await this.prisma.providerDocument.findMany({
      where,
      include: {
        relationship: { select: { id: true, ownerOrgId: true, providerId: true } },
      },
      orderBy: { uploadedAt: 'desc' },
    })
    return docs.map((doc) => this.mapDocument(doc))
  }

  async createDocument(data: CreateProviderDocumentDto, actorId?: string) {
    const actor = await this.authz.getActor(actorId)
    const isPlatform = this.authz.isPlatformOps(actor.role)
    const isProvider = this.authz.isProviderRole(actor.role)
    const isOwner = this.authz.isOwnerRole(actor.role)
    if (!isPlatform && !isProvider && !isOwner) {
      throw new ForbiddenException('You do not have permission to upload provider documents')
    }

    let providerId = data.providerId
    let relationshipId = data.relationshipId
    let ownerOrgId: string | undefined

    if (relationshipId) {
      const relationship = await this.prisma.providerRelationship.findUnique({
        where: { id: relationshipId },
        select: { id: true, providerId: true, ownerOrgId: true },
      })
      if (!relationship) throw new NotFoundException('Relationship not found')
      providerId = relationship.providerId
      ownerOrgId = relationship.ownerOrgId
    }

    if (isProvider) {
      if (!actor.providerId) throw new ForbiddenException('Provider user has no providerId scope')
      if (!providerId || providerId !== actor.providerId) {
        throw new ForbiddenException('providerId is outside your authenticated scope')
      }
    }

    if (isOwner) {
      if (!actor.organizationId) throw new ForbiddenException('Owner user has no organizationId scope')
      ownerOrgId = ownerOrgId || actor.organizationId
      if (ownerOrgId !== actor.organizationId) {
        throw new ForbiddenException('ownerOrgId is outside your authenticated scope')
      }
    }

    if (!providerId && !relationshipId) {
      throw new NotFoundException('Either providerId or relationshipId is required')
    }

    const doc = await this.prisma.providerDocument.create({
      data: {
        providerId,
        relationshipId,
        ownerOrgId,
        type: data.type,
        name: data.name,
        fileUrl: data.fileUrl,
        uploadedBy: actor.id,
        status: ProviderDocumentStatus.PENDING,
      },
      include: {
        relationship: { select: { id: true, ownerOrgId: true, providerId: true } },
      },
    })
    return this.mapDocument(doc)
  }

  async deleteDocument(id: string, actorId?: string) {
    const actor = await this.authz.getActor(actorId)
    const doc = await this.prisma.providerDocument.findUnique({
      where: { id },
      include: {
        relationship: { select: { id: true, ownerOrgId: true, providerId: true } },
      },
    })
    if (!doc) throw new NotFoundException('Provider document not found')

    if (!this.authz.isPlatformOps(actor.role)) {
      if (this.authz.isProviderRole(actor.role)) {
        if (!actor.providerId || doc.providerId !== actor.providerId) {
          throw new ForbiddenException('Document is outside your authenticated provider scope')
        }
      } else if (this.authz.isOwnerRole(actor.role)) {
        if (!actor.organizationId) throw new ForbiddenException('Owner user has no organizationId scope')
        const orgScoped = doc.ownerOrgId === actor.organizationId || doc.relationship?.ownerOrgId === actor.organizationId
        if (!orgScoped) {
          throw new ForbiddenException('Document is outside your authenticated organization scope')
        }
      } else {
        throw new ForbiddenException('You do not have permission to delete provider documents')
      }
    }

    await this.prisma.providerDocument.delete({ where: { id } })
  }
}

