import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { Prisma, ProviderDocumentStatus } from '@prisma/client'
import { v2 as cloudinary, UploadApiResponse } from 'cloudinary'
import * as streamifier from 'streamifier'
import { PrismaService } from '../../prisma.service'
import { ProviderAuthzService } from './provider-authz.service'
import {
  CreateProviderDocumentDto,
  ProviderDocumentsQueryDto,
  ReviewProviderDocumentDto,
  UploadProviderDocumentDto,
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
      requirementCode: document.requirementCode || undefined,
      category: document.category || undefined,
      name: document.name,
      fileUrl: document.fileUrl,
      cloudinaryPublicId: document.cloudinaryPublicId || undefined,
      issuer: document.issuer || undefined,
      documentNumber: document.documentNumber || undefined,
      issueDate: document.issueDate?.toISOString(),
      expiryDate: document.expiryDate?.toISOString(),
      coveredModels: document.coveredModels,
      coveredSites: document.coveredSites,
      version: document.version || undefined,
      uploadedAt: document.uploadedAt.toISOString(),
      uploadedBy: document.uploadedBy || undefined,
      status: document.status,
      reviewedBy: document.reviewedBy || undefined,
      reviewedAt: document.reviewedAt?.toISOString(),
      reviewNotes: document.reviewNotes || undefined,
      rejectionReason: document.rejectionReason || undefined,
      metadata: document.metadata || undefined,
    }
  }

  private parseMetadata(metadata?: string): Prisma.InputJsonValue | undefined {
    if (!metadata || !metadata.trim()) return undefined
    try {
      return JSON.parse(metadata) as Prisma.InputJsonValue
    } catch {
      throw new BadRequestException('metadata must be valid JSON')
    }
  }

  private async resolveDocumentScope(
    actor: Awaited<ReturnType<ProviderAuthzService['getActor']>>,
    input: { providerId?: string; relationshipId?: string },
  ): Promise<{ providerId?: string; relationshipId?: string; ownerOrgId?: string }> {
    const isProvider = this.authz.isProviderRole(actor.role)
    const isOwner = this.authz.isOwnerRole(actor.role)

    let providerId = input.providerId
    let relationshipId = input.relationshipId
    let ownerOrgId: string | undefined

    if (relationshipId) {
      const relationship = await this.prisma.providerRelationship.findUnique({
        where: { id: relationshipId },
        select: { id: true, providerId: true, ownerOrgId: true },
      })
      if (!relationship) throw new NotFoundException('Relationship not found')
      if (providerId && providerId !== relationship.providerId) {
        throw new BadRequestException('providerId does not match relationship providerId')
      }
      providerId = relationship.providerId
      ownerOrgId = relationship.ownerOrgId
    }

    if (!providerId && !relationshipId) {
      throw new BadRequestException('Either providerId or relationshipId is required')
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

    return { providerId, relationshipId, ownerOrgId }
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

    const scope = await this.resolveDocumentScope(actor, {
      providerId: data.providerId,
      relationshipId: data.relationshipId,
    })

    const doc = await this.prisma.providerDocument.create({
      data: {
        providerId: scope.providerId,
        relationshipId: scope.relationshipId,
        ownerOrgId: scope.ownerOrgId,
        type: data.type,
        requirementCode: data.requirementCode,
        category: data.category,
        name: data.name,
        fileUrl: data.fileUrl,
        issuer: data.issuer,
        documentNumber: data.documentNumber,
        issueDate: data.issueDate ? new Date(data.issueDate) : undefined,
        expiryDate: data.expiryDate ? new Date(data.expiryDate) : undefined,
        coveredModels: data.coveredModels ?? [],
        coveredSites: data.coveredSites ?? [],
        version: data.version,
        metadata: data.metadata as Prisma.InputJsonValue | undefined,
        uploadedBy: actor.id,
        status: ProviderDocumentStatus.PENDING,
      },
      include: {
        relationship: { select: { id: true, ownerOrgId: true, providerId: true } },
      },
    })
    return this.mapDocument(doc)
  }

  async uploadDocument(file: Express.Multer.File, data: UploadProviderDocumentDto, actorId?: string) {
    if (!file) throw new BadRequestException('File is required')

    const actor = await this.authz.getActor(actorId)
    const isPlatform = this.authz.isPlatformOps(actor.role)
    const isProvider = this.authz.isProviderRole(actor.role)
    const isOwner = this.authz.isOwnerRole(actor.role)
    if (!isPlatform && !isProvider && !isOwner) {
      throw new ForbiddenException('You do not have permission to upload provider documents')
    }

    const scope = await this.resolveDocumentScope(actor, {
      providerId: data.providerId,
      relationshipId: data.relationshipId,
    })

    const uploadResult = await new Promise<UploadApiResponse>((resolve, reject) => {
      const folder = scope.relationshipId
        ? `evzone-provider-documents/relationships/${scope.relationshipId}`
        : `evzone-provider-documents/providers/${scope.providerId || 'unknown'}`

      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder,
          resource_type: 'auto',
          context: `uploadedBy=${actor.id}|providerId=${scope.providerId || ''}|relationshipId=${scope.relationshipId || ''}`,
        },
        (error, result) => {
          if (error) return reject(error)
          if (!result) return reject(new Error('Cloudinary upload failed'))
          resolve(result)
        },
      )

      streamifier.createReadStream(file.buffer).pipe(uploadStream)
    })

    const created = await this.prisma.providerDocument.create({
      data: {
        providerId: scope.providerId,
        relationshipId: scope.relationshipId,
        ownerOrgId: scope.ownerOrgId,
        type: data.type,
        requirementCode: data.requirementCode,
        category: data.category,
        name: data.name || file.originalname,
        fileUrl: uploadResult.secure_url,
        cloudinaryPublicId: uploadResult.public_id,
        issuer: data.issuer,
        documentNumber: data.documentNumber,
        issueDate: data.issueDate ? new Date(data.issueDate) : undefined,
        expiryDate: data.expiryDate ? new Date(data.expiryDate) : undefined,
        coveredModels: data.coveredModels ?? [],
        coveredSites: data.coveredSites ?? [],
        version: data.version,
        metadata: this.parseMetadata(data.metadata),
        uploadedBy: actor.id,
        status: ProviderDocumentStatus.PENDING,
      },
      include: {
        relationship: { select: { id: true, ownerOrgId: true, providerId: true } },
      },
    })

    return this.mapDocument(created)
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

    if (doc.cloudinaryPublicId) {
      await cloudinary.uploader.destroy(doc.cloudinaryPublicId)
    }

    await this.prisma.providerDocument.delete({ where: { id } })
  }

  async reviewDocument(id: string, data: ReviewProviderDocumentDto, actorId?: string) {
    const actor = await this.authz.getActor(actorId)
    this.authz.requirePlatformOps(actor)

    const existing = await this.prisma.providerDocument.findUnique({ where: { id } })
    if (!existing) throw new NotFoundException('Provider document not found')

    if (data.status === ProviderDocumentStatus.REJECTED && !data.rejectionReason && !data.reviewNotes) {
      throw new BadRequestException('rejectionReason or reviewNotes is required when rejecting a document')
    }

    const updated = await this.prisma.providerDocument.update({
      where: { id },
      data: {
        status: data.status,
        reviewedBy: data.reviewedBy || actor.id,
        reviewedAt: new Date(),
        reviewNotes: data.reviewNotes || null,
        rejectionReason:
          data.status === ProviderDocumentStatus.REJECTED
            ? data.rejectionReason || data.reviewNotes || null
            : null,
      },
      include: {
        relationship: { select: { id: true, ownerOrgId: true, providerId: true } },
      },
    })

    return this.mapDocument(updated)
  }
}
