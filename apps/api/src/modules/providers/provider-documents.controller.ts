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
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { UserRole } from '@prisma/client'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { RolesGuard } from '../auth/roles.guard'
import { Roles } from '../auth/roles.decorator'
import {
  CreateProviderDocumentDto,
  ProviderDocumentsQueryDto,
  ReviewProviderDocumentDto,
  UploadProviderDocumentDto,
} from './dto/providers.dto'
import { ProviderDocumentsService } from './provider-documents.service'

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
  constructor(private readonly providerDocumentsService: ProviderDocumentsService) {}

  @Get()
  getAll(@Query() query: ProviderDocumentsQueryDto, @Req() req: any) {
    return this.providerDocumentsService.listDocuments(query, req.user?.sub)
  }

  @Post('upload')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 10 * 1024 * 1024 },
    }),
  )
  upload(@UploadedFile() file: Express.Multer.File, @Body() body: UploadProviderDocumentDto, @Req() req: any) {
    return this.providerDocumentsService.uploadDocument(file, body, req.user?.sub)
  }

  /**
   * @deprecated Use POST /provider-documents/upload for native file uploads.
   */
  @Post()
  create(@Body() body: CreateProviderDocumentDto, @Req() req: any) {
    return this.providerDocumentsService.createDocument(body, req.user?.sub)
  }

  @Patch(':id')
  review(@Param('id') id: string, @Body() body: ReviewProviderDocumentDto, @Req() req: any) {
    return this.providerDocumentsService.reviewDocument(id, body, req.user?.sub)
  }

  @Post(':id/review')
  reviewLegacy(@Param('id') id: string, @Body() body: ReviewProviderDocumentDto, @Req() req: any) {
    return this.providerDocumentsService.reviewDocument(id, body, req.user?.sub)
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @Req() req: any) {
    await this.providerDocumentsService.deleteDocument(id, req.user?.sub)
    return { success: true }
  }
}
