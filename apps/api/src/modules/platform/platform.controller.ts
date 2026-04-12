import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { PlatformService } from './platform.service';
import {
  AssignPlatformRoleDto,
  CreatePlatformTenantDto,
  SuspendTenantDto,
  UpdatePlatformTenantDto,
} from '../tenant-provisioning/dto/tenant-provisioning.dto';
import { AssignTenantMembershipDto } from '../tenant-rbac/dto/tenant-rbac.dto';
import {
  CreateTierPricingDraftDto,
  PublishTierPricingVersionDto,
} from './dto/tier-pricing.dto';

type PlatformRequest = Request & {
  user?: {
    sub?: string;
    role?: string;
    canonicalRole?: string;
    accessProfile?: {
      canonicalRole?: string;
    };
  };
};

@Controller('platform')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class PlatformController {
  constructor(private readonly platformService: PlatformService) {}

  private assertSuperAdmin(req: PlatformRequest): string {
    const actorId = req.user?.sub;
    if (!actorId) {
      throw new BadRequestException('Authenticated user is required');
    }

    const canonicalRole =
      req.user?.canonicalRole || req.user?.accessProfile?.canonicalRole;
    if (
      canonicalRole !== 'PLATFORM_SUPER_ADMIN' &&
      req.user?.role !== 'SUPER_ADMIN'
    ) {
      throw new ForbiddenException(
        'Only platform super admins can manage tier pricing',
      );
    }

    return actorId;
  }

  @Get('tenants')
  @RequirePermissions('platform.tenants.read')
  listTenants() {
    return this.platformService.listTenants();
  }

  @Post('tenants')
  @RequirePermissions('platform.tenants.write')
  createTenant(@Body() body: CreatePlatformTenantDto) {
    return this.platformService.createTenant(body);
  }

  @Patch('tenants/:id')
  @RequirePermissions('platform.tenants.write')
  updateTenant(@Param('id') id: string, @Body() body: UpdatePlatformTenantDto) {
    return this.platformService.updateTenant(id, body);
  }

  @Post('tenants/:id/suspend')
  @RequirePermissions('platform.tenants.write')
  suspendTenant(@Param('id') id: string, @Body() body: SuspendTenantDto) {
    return this.platformService.suspendTenant(id, body);
  }

  @Post('tenants/:id/memberships')
  @RequirePermissions('platform.tenants.write')
  assignTenantMembership(
    @Param('id') id: string,
    @Body() body: AssignTenantMembershipDto,
    @Req() req: PlatformRequest,
  ) {
    const actorId = req.user?.sub;
    if (!actorId) {
      throw new BadRequestException('Authenticated user is required');
    }

    return this.platformService.assignTenantMembership(id, body, actorId);
  }

  @Get('role-templates')
  @RequirePermissions('platform.tenants.read')
  listPlatformRoleTemplates() {
    return this.platformService.listPlatformRoleTemplates();
  }

  @Post('users/:userId/roles')
  @RequirePermissions('platform.tenants.write')
  assignPlatformRole(
    @Param('userId') userId: string,
    @Body() body: AssignPlatformRoleDto,
    @Req() req: PlatformRequest,
  ) {
    const actorId = req.user?.sub;
    if (!actorId) {
      throw new BadRequestException('Authenticated user is required');
    }

    return this.platformService.assignPlatformRole(userId, body, actorId);
  }

  @Get('system-health')
  @RequirePermissions('platform.health.read')
  getSystemHealth() {
    return this.platformService.getSystemHealth();
  }

  @Get('tier-pricing')
  @RequirePermissions('platform.tenants.read')
  listTierPricing(
    @Req() req: PlatformRequest,
    @Query('includeHistory') includeHistoryRaw?: string,
  ) {
    this.assertSuperAdmin(req);
    const includeHistory = includeHistoryRaw === 'true';
    return this.platformService.listTierPricing(includeHistory);
  }

  @Post('tier-pricing/:tierCode/drafts')
  @RequirePermissions('platform.tenants.write')
  createTierPricingDraft(
    @Param('tierCode') tierCode: string,
    @Body() body: CreateTierPricingDraftDto,
    @Req() req: PlatformRequest,
  ) {
    const actorId = this.assertSuperAdmin(req);
    return this.platformService.createTierPricingDraft(tierCode, body, actorId);
  }

  @Post('tier-pricing/:tierCode/publish')
  @RequirePermissions('platform.tenants.write')
  publishTierPricingVersion(
    @Param('tierCode') tierCode: string,
    @Body() body: PublishTierPricingVersionDto,
    @Req() req: PlatformRequest,
  ) {
    const actorId = this.assertSuperAdmin(req);
    return this.platformService.publishTierPricingVersion(
      tierCode,
      body.version,
      actorId,
    );
  }
}
