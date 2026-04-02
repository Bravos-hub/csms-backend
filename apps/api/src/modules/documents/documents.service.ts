import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import {
  DocumentCategory,
  DocumentStatus,
  EntityType,
  Prisma,
} from '@prisma/client';
import { UploadDocumentDto } from './dto/upload-document.dto';
import { VerifyDocumentDto } from './dto/verify-document.dto';
import { MediaStorageService } from '../../common/services/media-storage.service';

@Injectable()
export class DocumentsService {
  constructor(
    private prisma: PrismaService,
    private readonly mediaStorage: MediaStorageService,
  ) {}

  async uploadFile(
    file: Express.Multer.File,
    uploadDto: UploadDocumentDto,
    userId: string,
  ) {
    if (!file) {
      throw new BadRequestException('File is required');
    }

    // Upload to Cloudinary
    const uploadResult = await this.mediaStorage.uploadBuffer({
      buffer: file.buffer,
      folder: `evzone-documents/${uploadDto.entityType.toLowerCase()}/${uploadDto.entityId}`,
      resourceType: 'auto',
      context: `uploadedBy=${userId}|entityType=${uploadDto.entityType}|entityId=${uploadDto.entityId}|category=${uploadDto.category}`,
    });

    // Create Document record in DB
    return this.prisma.document.create({
      data: {
        category: uploadDto.category as DocumentCategory,
        entityType: uploadDto.entityType as EntityType,
        entityId: uploadDto.entityId,
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
    return this.prisma.document.findMany({
      where: {
        entityType: entityType as EntityType,
        entityId,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async findOne(id: string) {
    return this.prisma.document.findUnique({
      where: { id },
    });
  }

  async verifyDocument(
    id: string,
    verifyDto: VerifyDocumentDto,
    verifierId: string,
  ) {
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
    const doc = await this.prisma.document.findUnique({ where: { id } });
    await this.mediaStorage.delete(doc?.cloudinaryPublicId);
    return this.prisma.document.delete({ where: { id } });
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
