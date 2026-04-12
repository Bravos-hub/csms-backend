import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Put,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import type { Request } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { TenantBrandingService } from './tenant-branding.service';
import {
  RollbackBrandingDto,
  UploadBrandingAssetDto,
  UpsertBrandingDraftDto,
} from './dto/tenant-branding.dto';

type BrandingRequest = Request & {
  user?: {
    sub?: string;
  };
};

@Controller('tenant-branding')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class TenantBrandingController {
  constructor(private readonly tenantBranding: TenantBrandingService) {}

  @Get()
  @RequirePermissions('tenant.branding.read')
  async getBrandingState(@Req() req: BrandingRequest) {
    return this.tenantBranding.getBrandingForTenantActor(
      this.requireActorId(req),
    );
  }

  @Put('draft')
  @RequirePermissions('tenant.branding.write')
  async saveDraft(
    @Req() req: BrandingRequest,
    @Body() dto: UpsertBrandingDraftDto,
  ) {
    return this.tenantBranding.saveDraftForTenantActor(
      this.requireActorId(req),
      dto.config,
    );
  }

  @Post('publish')
  @RequirePermissions('tenant.branding.write')
  async publishDraft(@Req() req: BrandingRequest) {
    return this.tenantBranding.publishDraftForTenantActor(
      this.requireActorId(req),
    );
  }

  @Post('rollback')
  @RequirePermissions('tenant.branding.write')
  async rollback(
    @Req() req: BrandingRequest,
    @Body() dto: RollbackBrandingDto,
  ) {
    return this.tenantBranding.rollbackForTenantActor(
      this.requireActorId(req),
      dto.version,
    );
  }

  @Post('assets')
  @RequirePermissions('tenant.branding.write')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 5 * 1024 * 1024 },
    }),
  )
  async uploadAsset(
    @Req() req: BrandingRequest,
    @Body() dto: UploadBrandingAssetDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.tenantBranding.uploadAssetForTenantActor(
      this.requireActorId(req),
      {
        ...dto,
        file,
      },
    );
  }

  private requireActorId(req: BrandingRequest): string {
    const actorId = req.user?.sub;
    if (!actorId) {
      throw new BadRequestException('Authenticated user is required');
    }
    return actorId;
  }
}
