import { Controller, Get, Req } from '@nestjs/common';
import type { Request } from 'express';
import { TenantContextService } from '@app/db';
import { Public } from '../auth/public.decorator';
import { TenantBrandingService } from './tenant-branding.service';

@Controller('public/tenant-branding')
export class PublicTenantBrandingController {
  constructor(
    private readonly tenantBranding: TenantBrandingService,
    private readonly tenantContext: TenantContextService,
  ) {}

  @Get()
  @Public()
  async getRuntimeBranding(@Req() req: Request) {
    const context = this.tenantContext.get();
    const host = req.header('x-forwarded-host') || req.header('host') || null;

    return this.tenantBranding.getPublicRuntimeBranding({
      host,
      resolvedTenantId: context?.effectiveOrganizationId || null,
    });
  }
}
