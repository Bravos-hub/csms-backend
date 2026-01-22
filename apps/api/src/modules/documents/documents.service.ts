import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { v2 as cloudinary, UploadApiResponse } from 'cloudinary';
import * as streamifier from 'streamifier';
import { DocumentCategory, DocumentStatus, EntityType } from '@prisma/client';
import { UploadDocumentDto } from './dto/upload-document.dto';
import { VerifyDocumentDto } from './dto/verify-document.dto';

@Injectable()
export class DocumentsService {
    constructor(private prisma: PrismaService) { }

    async uploadFile(file: Express.Multer.File, uploadDto: UploadDocumentDto, userId: string) {
        if (!file) {
            throw new BadRequestException('File is required');
        }

        // Upload to Cloudinary
        const uploadResult = await new Promise<UploadApiResponse>((resolve, reject) => {
            const uploadStream = cloudinary.uploader.upload_stream(
                {
                    folder: `evzone-documents/${uploadDto.entityType.toLowerCase()}/${uploadDto.entityId}`,
                    resource_type: 'auto',
                    context: `uploadedBy=${userId}|entityType=${uploadDto.entityType}|entityId=${uploadDto.entityId}|category=${uploadDto.category}`,
                },
                (error, result) => {
                    if (error) return reject(error);
                    if (!result) return reject(new Error('Cloudinary upload failed'));
                    resolve(result);
                },
            );
            streamifier.createReadStream(file.buffer).pipe(uploadStream);
        });

        // Create Document record in DB
        return this.prisma.document.create({
            data: {
                category: uploadDto.category as DocumentCategory,
                entityType: uploadDto.entityType as EntityType,
                entityId: uploadDto.entityId,
                fileName: file.originalname,
                fileUrl: uploadResult.secure_url,
                fileType: uploadResult.format || 'unknown',
                fileSize: uploadResult.bytes,
                cloudinaryPublicId: uploadResult.public_id,
                uploadedBy: userId,
                isRequired: uploadDto.isRequired || false,
                metadata: uploadDto.metadata ? JSON.parse(uploadDto.metadata) : undefined,
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

    async verifyDocument(id: string, verifyDto: VerifyDocumentDto, verifierId: string) {
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
        if (doc && doc.cloudinaryPublicId) {
            await cloudinary.uploader.destroy(doc.cloudinaryPublicId);
        }
        return this.prisma.document.delete({ where: { id } });
    }
}
