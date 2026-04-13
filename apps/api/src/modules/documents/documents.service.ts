import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import {
  DocumentCategory,
  DocumentStatus,
  EntityType,
  MembershipStatus,
  Prisma,
} from '@prisma/client';
import { UploadDocumentDto } from './dto/upload-document.dto';
import { VerifyDocumentDto } from './dto/verify-document.dto';
import { MediaStorageService } from '../../common/services/media-storage.service';
import {
  TenantGuardrailsService,
  TenantScope,
} from '../../common/tenant/tenant-guardrails.service';

@Injectable()
export class DocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mediaStorage: MediaStorageService,
    private readonly tenantGuardrails: TenantGuardrailsService,
  ) {}

  async uploadFile(
    file: Express.Multer.File,
    uploadDto: UploadDocumentDto,
    userId: string,
  ) {
    if (!file) {
      throw new BadRequestException('File is required');
    }

    const scope = await this.tenantGuardrails.requireTenantScope('tenant');
    const entityType = this.parseEntityType(uploadDto.entityType);
    const entityId = uploadDto.entityId.trim();
    if (!entityId) {
      throw new BadRequestException('entityId is required');
    }
    await this.assertEntityInTenant(entityType, entityId, scope);

    const uploadResult = await this.mediaStorage.uploadBuffer({
      buffer: file.buffer,
      folder: `evzone-documents/${entityType.toLowerCase()}/${entityId}`,
      resourceType: 'auto',
      context: `uploadedBy=${userId}|entityType=${entityType}|entityId=${entityId}|category=${uploadDto.category}`,
    });

    return this.prisma.document.create({
      data: {
        category: uploadDto.category as DocumentCategory,
        entityType,
        entityId,
        fileName: file.originalname,
        fileUrl: uploadResult.url,
        fileType: uploadResult.format || 'unknown',
        fileSize: uploadResult.bytes,
        cloudinaryPublicId: uploadResult.publicId,
        uploadedBy: userId,
        isRequired: uploadDto.isRequired || false,
        metadata: this.parseMetadata(uploadDto.metadata),
        status: DocumentStatus.PENDING,
      },
    });
  }

  async findAll(entityType: string, entityId: string) {
    const scope = await this.tenantGuardrails.requireTenantScope('tenant');
    const normalizedEntityType = this.parseEntityType(entityType);
    const normalizedEntityId = entityId.trim();
    if (!normalizedEntityId) {
      throw new BadRequestException('entityId is required');
    }

    await this.assertEntityInTenant(
      normalizedEntityType,
      normalizedEntityId,
      scope,
    );

    return this.prisma.document.findMany({
      where: {
        entityType: normalizedEntityType,
        entityId: normalizedEntityId,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async findOne(id: string) {
    const scope = await this.tenantGuardrails.requireTenantScope('tenant');
    const document = await this.requireDocumentInTenant(id, scope);
    return document;
  }

  async verifyDocument(
    id: string,
    verifyDto: VerifyDocumentDto,
    verifierId: string,
  ) {
    const scope = await this.tenantGuardrails.requireTenantScope('tenant');
    await this.requireDocumentInTenant(id, scope);

    return this.prisma.document.update({
      where: { id },
      data: {
        status: verifyDto.status as DocumentStatus,
        notes: verifyDto.notes,
        rejectionReason: verifyDto.rejectionReason,
        verifiedBy: verifierId,
        verifiedAt: new Date(),
      },
    });
  }

  async deleteDocument(id: string) {
    const scope = await this.tenantGuardrails.requireTenantScope('tenant');
    const document = await this.requireDocumentInTenant(id, scope);
    await this.mediaStorage.delete(document.cloudinaryPublicId);
    return this.prisma.document.delete({ where: { id: document.id } });
  }

  private async requireDocumentInTenant(id: string, scope: TenantScope) {
    const document = await this.prisma.document.findUnique({ where: { id } });
    if (!document) {
      throw new NotFoundException('Document not found');
    }

    await this.assertEntityInTenant(
      document.entityType,
      document.entityId,
      scope,
    );
    return document;
  }

  private async assertEntityInTenant(
    entityType: EntityType,
    entityId: string,
    scope: TenantScope,
  ): Promise<void> {
    const controlPlane = this.prisma.getControlPlaneClient();

    if (entityType === EntityType.TENANT) {
      if (entityId !== scope.tenantId) {
        throw new ForbiddenException('Document entity is outside tenant scope');
      }
      return;
    }

    if (entityType === EntityType.SITE) {
      const site = await controlPlane.site.findFirst({
        where: {
          id: entityId,
          organizationId: scope.tenantId,
        },
        select: { id: true },
      });
      if (!site) {
        throw new ForbiddenException('Site is outside tenant scope');
      }
      return;
    }

    if (entityType === EntityType.USER) {
      const [user, membership] = await Promise.all([
        controlPlane.user.findUnique({
          where: { id: entityId },
          select: { id: true, organizationId: true },
        }),
        controlPlane.organizationMembership.findUnique({
          where: {
            userId_organizationId: {
              userId: entityId,
              organizationId: scope.tenantId,
            },
          },
          select: { status: true },
        }),
      ]);

      if (!user) {
        throw new NotFoundException('User not found');
      }

      const inTenant =
        user.organizationId === scope.tenantId ||
        membership?.status === MembershipStatus.ACTIVE;

      if (!inTenant) {
        throw new ForbiddenException('User is outside tenant scope');
      }
      return;
    }

    if (entityType === EntityType.APPLICATION) {
      const application = await controlPlane.tenantApplication.findUnique({
        where: { id: entityId },
        select: {
          id: true,
          provisionedOrganizationId: true,
          applicant: {
            select: {
              organizationId: true,
            },
          },
          site: {
            select: {
              organizationId: true,
            },
          },
        },
      });

      if (!application) {
        throw new NotFoundException('Application not found');
      }

      const inTenant =
        application.provisionedOrganizationId === scope.tenantId ||
        application.applicant?.organizationId === scope.tenantId ||
        application.site?.organizationId === scope.tenantId;

      if (!inTenant) {
        throw new ForbiddenException('Application is outside tenant scope');
      }
      return;
    }

    throw new ForbiddenException('Unsupported document entity scope');
  }

  private parseEntityType(value: string): EntityType {
    const normalized = value.trim().toUpperCase();
    if (Object.values(EntityType).includes(normalized as EntityType)) {
      return normalized as EntityType;
    }
    throw new BadRequestException(`Unsupported entityType "${value}"`);
  }

  private parseMetadata(
    metadata: string | undefined,
  ): Prisma.InputJsonValue | undefined {
    if (!metadata) {
      return undefined;
    }

    try {
      const parsed: unknown = JSON.parse(metadata);
      return parsed as Prisma.InputJsonValue;
    } catch {
      throw new BadRequestException('metadata must be valid JSON');
    }
  }
}
