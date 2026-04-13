import {
  BadRequestException,
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Param,
  Body,
  Req,
  UseGuards,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import type { Request } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { DocumentsService } from './documents.service';
import { UploadDocumentDto } from './dto/upload-document.dto';
import { VerifyDocumentDto } from './dto/verify-document.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

type DocumentsRequest = Request & {
  user?: {
    sub?: string;
  };
};

@Controller('documents')
@UseGuards(JwtAuthGuard)
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  private assertAuthenticatedUserId(req: DocumentsRequest): string {
    const userId = req.user?.sub;
    if (!userId) {
      throw new BadRequestException('Authenticated user is required');
    }
    return userId;
  }

  @Post()
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
    }),
  )
  async uploadDocument(
    @UploadedFile() file: Express.Multer.File,
    @Body() uploadDto: UploadDocumentDto,
    @Req() req: DocumentsRequest,
  ) {
    const userId = this.assertAuthenticatedUserId(req);
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
    @Req() req: DocumentsRequest,
  ) {
    const verifierId = this.assertAuthenticatedUserId(req);
    return this.documentsService.verifyDocument(id, verifyDto, verifierId);
  }

  @Delete(':id')
  async deleteDocument(@Param('id') id: string) {
    return this.documentsService.deleteDocument(id);
  }
}
