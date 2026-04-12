import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
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

@Controller('platform/tenants/:tenantId/branding')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class PlatformTenantBrandingController {
  constructor(private readonly tenantBranding: TenantBrandingService) {}

  @Get()
  @RequirePermissions('platform.tenants.read')
  async getBrandingState(
    @Req() req: BrandingRequest,
    @Param('tenantId') tenantId: string,
  ) {
    return this.tenantBranding.getBrandingForPlatformActor(
      this.requireActorId(req),
      tenantId,
    );
  }

  @Put('draft')
  @RequirePermissions('platform.tenants.write')
  async saveDraft(
    @Req() req: BrandingRequest,
    @Param('tenantId') tenantId: string,
    @Body() dto: UpsertBrandingDraftDto,
  ) {
    return this.tenantBranding.saveDraftForPlatformActor(
      this.requireActorId(req),
      tenantId,
      dto.config,
    );
  }

  @Post('publish')
  @RequirePermissions('platform.tenants.write')
  async publishDraft(
    @Req() req: BrandingRequest,
    @Param('tenantId') tenantId: string,
  ) {
    return this.tenantBranding.publishDraftForPlatformActor(
      this.requireActorId(req),
      tenantId,
    );
  }

  @Post('rollback')
  @RequirePermissions('platform.tenants.write')
  async rollback(
    @Req() req: BrandingRequest,
    @Param('tenantId') tenantId: string,
    @Body() dto: RollbackBrandingDto,
  ) {
    return this.tenantBranding.rollbackForPlatformActor(
      this.requireActorId(req),
      tenantId,
      dto.version,
    );
  }

  @Post('assets')
  @RequirePermissions('platform.tenants.write')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 5 * 1024 * 1024 },
    }),
  )
  async uploadAsset(
    @Req() req: BrandingRequest,
    @Param('tenantId') tenantId: string,
    @Body() dto: UploadBrandingAssetDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.tenantBranding.uploadAssetForPlatformActor(
      this.requireActorId(req),
      tenantId,
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
