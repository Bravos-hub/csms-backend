import { Controller, Post, Get, Patch, Delete, Param, Body, UseInterceptors, UploadedFile, Query, UseGuards } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { DocumentsService } from './documents.service';
import { UploadDocumentDto } from './dto/upload-document.dto';
import { VerifyDocumentDto } from './dto/verify-document.dto';

@Controller('documents')
export class DocumentsController {
    constructor(private readonly documentsService: DocumentsService) { }

    @Post()
    @UseInterceptors(FileInterceptor('file', {
        limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
    }))
    async uploadDocument(
        @UploadedFile() file: Express.Multer.File,
        @Body() uploadDto: UploadDocumentDto,
    ) {
        // TODO: Get userId from request/auth guard
        const userId = 'mock-user-id';
        return this.documentsService.uploadFile(file, uploadDto, userId);
    }

    @Get(':entityType/:entityId')
    async getDocuments(
        @Param('entityType') entityType: string,
        @Param('entityId') entityId: string,
    ) {
        return this.documentsService.findAll(entityType.toUpperCase(), entityId);
    }

    @Patch(':id/verify')
    async verifyDocument(
        @Param('id') id: string,
        @Body() verifyDto: VerifyDocumentDto,
    ) {
        // TODO: Get verifierId from request
        const verifierId = 'mock-admin-id';
        return this.documentsService.verifyDocument(id, verifyDto, verifierId);
    }

    @Delete(':id')
    async deleteDocument(@Param('id') id: string) {
        return this.documentsService.deleteDocument(id);
    }
}
