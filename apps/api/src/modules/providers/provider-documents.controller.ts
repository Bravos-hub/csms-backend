import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import {
  CreateProviderDocumentDto,
  ProviderDocumentsQueryDto,
  ReviewProviderDocumentDto,
  UploadProviderDocumentDto,
} from './dto/providers.dto';
import { ProviderDocumentsService } from './provider-documents.service';

type ProviderRequestContext = {
  user?: {
    sub?: string;
  };
};

@Controller('provider-documents')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(
  UserRole.SUPER_ADMIN,
  UserRole.EVZONE_ADMIN,
  UserRole.EVZONE_OPERATOR,
  UserRole.STATION_OWNER,
  UserRole.STATION_OPERATOR,
  UserRole.SWAP_PROVIDER_ADMIN,
  UserRole.SWAP_PROVIDER_OPERATOR,
)
export class ProviderDocumentsController {
  constructor(
    private readonly providerDocumentsService: ProviderDocumentsService,
  ) {}

  private actorId(req: ProviderRequestContext): string | undefined {
    return req.user?.sub;
  }

  @Get()
  getAll(
    @Query() query: ProviderDocumentsQueryDto,
    @Req() req: ProviderRequestContext,
  ) {
    return this.providerDocumentsService.listDocuments(
      query,
      this.actorId(req),
    );
  }

  @Post('upload')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 10 * 1024 * 1024 },
    }),
  )
  upload(
    @UploadedFile() file: Express.Multer.File,
    @Body() body: UploadProviderDocumentDto,
    @Req() req: ProviderRequestContext,
  ) {
    return this.providerDocumentsService.uploadDocument(
      file,
      body,
      this.actorId(req),
    );
  }

  /**
   * @deprecated Use POST /provider-documents/upload for native file uploads.
   */
  @Post()
  create(
    @Body() body: CreateProviderDocumentDto,
    @Req() req: ProviderRequestContext,
  ) {
    return this.providerDocumentsService.createDocument(
      body,
      this.actorId(req),
    );
  }

  @Patch(':id')
  review(
    @Param('id') id: string,
    @Body() body: ReviewProviderDocumentDto,
    @Req() req: ProviderRequestContext,
  ) {
    return this.providerDocumentsService.reviewDocument(
      id,
      body,
      this.actorId(req),
    );
  }

  @Post(':id/review')
  reviewLegacy(
    @Param('id') id: string,
    @Body() body: ReviewProviderDocumentDto,
    @Req() req: ProviderRequestContext,
  ) {
    return this.providerDocumentsService.reviewDocument(
      id,
      body,
      this.actorId(req),
    );
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @Req() req: ProviderRequestContext) {
    await this.providerDocumentsService.deleteDocument(id, this.actorId(req));
    return { success: true };
  }
}
