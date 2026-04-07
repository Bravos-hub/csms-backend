import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { TenantRbacService } from './tenant-rbac.service';
import {
  AssignTenantMembershipDto,
  CreateTenantCustomRoleDto,
  UpdateTenantCustomRoleDto,
} from './dto/tenant-rbac.dto';

type TenantAwareRequest = Request & {
  user?: {
    sub?: string;
    tenantId?: string;
    activeTenantId?: string;
    organizationId?: string;
    activeOrganizationId?: string;
  };
};

@Controller('tenant-rbac')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class TenantRbacController {
  constructor(private readonly tenantRbacService: TenantRbacService) {}

  @Get('permissions')
  @RequirePermissions('tenant.roles.read')
  listPermissionCatalog() {
    return this.tenantRbacService.listPermissionCatalog();
  }

  @Get('role-templates')
  @RequirePermissions('tenant.roles.read')
  listSystemRoleTemplates() {
    return this.tenantRbacService.listSystemRoleTemplates();
  }

  @Get('custom-roles')
  @RequirePermissions('tenant.roles.read')
  listCustomRoles(@Req() req: TenantAwareRequest) {
    return this.tenantRbacService.listCustomRoles(this.getActiveTenantId(req));
  }

  @Post('custom-roles')
  @RequirePermissions('tenant.roles.write')
  createCustomRole(
    @Body() body: CreateTenantCustomRoleDto,
    @Req() req: TenantAwareRequest,
  ) {
    const actorId = req.user?.sub;
    if (!actorId) {
      throw new BadRequestException('Authenticated user is required');
    }

    return this.tenantRbacService.createCustomRole(
      this.getActiveTenantId(req),
      body,
      actorId,
    );
  }

  @Patch('custom-roles/:id')
  @RequirePermissions('tenant.roles.write')
  updateCustomRole(
    @Param('id') id: string,
    @Body() body: UpdateTenantCustomRoleDto,
    @Req() req: TenantAwareRequest,
  ) {
    const actorId = req.user?.sub;
    if (!actorId) {
      throw new BadRequestException('Authenticated user is required');
    }

    return this.tenantRbacService.updateCustomRole(
      this.getActiveTenantId(req),
      id,
      body,
      actorId,
    );
  }

  @Get('memberships')
  @RequirePermissions('tenant.memberships.read')
  listMemberships(@Req() req: TenantAwareRequest) {
    return this.tenantRbacService.listMemberships(this.getActiveTenantId(req));
  }

  @Post('memberships')
  @RequirePermissions('tenant.memberships.write')
  assignMembership(
    @Body() body: AssignTenantMembershipDto,
    @Req() req: TenantAwareRequest,
  ) {
    const actorId = req.user?.sub;
    if (!actorId) {
      throw new BadRequestException('Authenticated user is required');
    }

    return this.tenantRbacService.assignMembership(
      this.getActiveTenantId(req),
      body,
      actorId,
    );
  }

  private getActiveTenantId(req: TenantAwareRequest) {
    const tenantId =
      req.user?.activeTenantId ||
      req.user?.tenantId ||
      req.user?.activeOrganizationId ||
      req.user?.organizationId;

    if (!tenantId) {
      throw new BadRequestException(
        'Active tenant context is required for tenant RBAC operations',
      );
    }

    return tenantId;
  }
}
