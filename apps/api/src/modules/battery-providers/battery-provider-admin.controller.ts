import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
  Req,
  ParseIntPipe,
  DefaultValuePipe,
  ForbiddenException,
} from '@nestjs/common';
import { ApiTags, ApiCookieAuth } from '@nestjs/swagger';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { TenantGuardrailsService } from '../../common/tenant/tenant-guardrails.service';
import {
  BatteryProviderAssignmentStatus,
  BatteryProviderUserRole,
} from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import { BatteryProviderAccessService } from './battery-provider-access.service';

interface AuthenticatedRequest extends Request {
  user: {
    sub: string;
    role?: string;
    canonicalRole?: string;
    permissions?: string[];
    tenantId?: string;
    organizationId?: string;
    activeOrganizationId?: string;
    selectedTenantId?: string;
  };
}

@ApiTags('Battery Provider Admin')
@ApiCookieAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('cpo/admin/battery-provider')
export class BatteryProviderAdminController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantGuardrails: TenantGuardrailsService,
    private readonly providerAccess: BatteryProviderAccessService,
  ) {}

  private resolveTenantId(req: AuthenticatedRequest): string {
    return (
      req.user.selectedTenantId ||
      req.user.activeOrganizationId ||
      req.user.tenantId ||
      req.user.organizationId ||
      ''
    );
  }

  private async assertTenantAdmin(
    req: AuthenticatedRequest,
    tenantId: string,
  ): Promise<void> {
    const userTenantId = this.resolveTenantId(req);
    const isPlatform =
      req.user.canonicalRole === 'PLATFORM_SUPER_ADMIN' ||
      req.user.canonicalRole === 'PLATFORM_NOC_LEAD';

    if (!isPlatform && userTenantId !== tenantId) {
      throw new ForbiddenException('Cross-tenant access denied');
    }
  }

  @Post('assignments')
  @RequirePermissions('tenant.settings.write')
  async createAssignment(
    @Req() req: AuthenticatedRequest,
    @Body()
    body: {
      tenantId: string;
      providerId: string;
      assignedStationIds?: string[];
      assignedCabinetIds?: string[];
      contractType?: string;
    },
  ) {
    await this.assertTenantAdmin(req, body.tenantId);

    return this.prisma.batteryProviderAssignment.create({
      data: {
        tenantId: body.tenantId,
        providerId: body.providerId,
        assignedStationIds: body.assignedStationIds ?? [],
        assignedCabinetIds: body.assignedCabinetIds ?? [],
        contractType: body.contractType,
        status: 'PENDING',
      },
    });
  }

  @Get('assignments')
  @RequirePermissions('tenant.settings.read')
  async listAssignments(
    @Req() req: AuthenticatedRequest,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(25), ParseIntPipe) limit: number,
    @Query('tenantId') tenantId?: string,
    @Query('providerId') providerId?: string,
    @Query('status') status?: string,
  ) {
    const effectiveTenantId = tenantId || this.resolveTenantId(req);
    await this.assertTenantAdmin(req, effectiveTenantId);

    const where: Record<string, unknown> = { tenantId: effectiveTenantId };
    if (providerId) where.providerId = providerId;
    if (status) where.status = status;

    const skip = (page - 1) * limit;
    const [items, total] = await Promise.all([
      this.prisma.batteryProviderAssignment.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.batteryProviderAssignment.count({ where }),
    ]);

    return { items, total, page, limit };
  }

  @Patch('assignments/:id')
  @RequirePermissions('tenant.settings.write')
  async updateAssignment(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body()
    body: {
      status?: string;
      assignedStationIds?: string[];
      assignedCabinetIds?: string[];
      contractType?: string;
      endedAt?: string;
    },
  ) {
    const existing = await this.prisma.batteryProviderAssignment.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new ForbiddenException('Assignment not found');
    }
    await this.assertTenantAdmin(req, existing.tenantId);

    return this.prisma.batteryProviderAssignment.update({
      where: { id },
      data: {
        status: body.status as BatteryProviderAssignmentStatus,
        assignedStationIds: body.assignedStationIds,
        assignedCabinetIds: body.assignedCabinetIds,
        contractType: body.contractType,
        endedAt: body.endedAt ? new Date(body.endedAt) : undefined,
      },
    });
  }

  @Post('users')
  @RequirePermissions('tenant.users.write')
  async createUserScope(
    @Req() req: AuthenticatedRequest,
    @Body()
    body: {
      userId: string;
      tenantId: string;
      providerId: string;
      role: string;
      assignedStationIds?: string[];
      assignedCabinetIds?: string[];
    },
  ) {
    await this.assertTenantAdmin(req, body.tenantId);

    return this.prisma.batteryProviderUserScope.create({
      data: {
        userId: body.userId,
        tenantId: body.tenantId,
        providerId: body.providerId,
        role: body.role as BatteryProviderUserRole,
        assignedStationIds: body.assignedStationIds ?? [],
        assignedCabinetIds: body.assignedCabinetIds ?? [],
      },
    });
  }

  @Get('users')
  @RequirePermissions('tenant.users.read')
  async listUserScopes(
    @Req() req: AuthenticatedRequest,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(25), ParseIntPipe) limit: number,
    @Query('tenantId') tenantId?: string,
    @Query('providerId') providerId?: string,
  ) {
    const effectiveTenantId = tenantId || this.resolveTenantId(req);
    await this.assertTenantAdmin(req, effectiveTenantId);

    const where: Record<string, unknown> = { tenantId: effectiveTenantId };
    if (providerId) where.providerId = providerId;

    const skip = (page - 1) * limit;
    const [items, total] = await Promise.all([
      this.prisma.batteryProviderUserScope.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.batteryProviderUserScope.count({ where }),
    ]);

    return { items, total, page, limit };
  }
}
