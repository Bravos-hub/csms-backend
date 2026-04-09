import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { EnterpriseIamService } from './enterprise-iam.service';
import {
  CreateEnterpriseIdentityProviderDto,
  CreateEnterpriseSyncImportJobDto,
  ListEnterpriseProvidersQueryDto,
  ListEnterpriseSyncJobsQueryDto,
  UpdateEnterpriseIdentityProviderDto,
  UpdateEnterpriseRoleMappingsDto,
} from './dto/enterprise-iam.dto';

type EnterpriseIamRequest = Request & {
  user?: {
    sub?: string;
  };
};

@Controller('enterprise-iam')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class EnterpriseIamController {
  constructor(private readonly enterpriseIamService: EnterpriseIamService) {}

  @Get('overview')
  @RequirePermissions('tenant.settings.read')
  async getOverview(
    @Req() req: EnterpriseIamRequest,
  ): Promise<Record<string, unknown>> {
    return this.enterpriseIamService.getOverview(this.requireActorId(req));
  }

  @Get('providers')
  @RequirePermissions('tenant.settings.read')
  async listProviders(
    @Req() req: EnterpriseIamRequest,
    @Query() query: ListEnterpriseProvidersQueryDto,
  ): Promise<Record<string, unknown>[]> {
    return this.enterpriseIamService.listProviders(
      this.requireActorId(req),
      query,
    );
  }

  @Post('providers')
  @RequirePermissions('tenant.settings.write')
  async createProvider(
    @Req() req: EnterpriseIamRequest,
    @Body() dto: CreateEnterpriseIdentityProviderDto,
  ): Promise<Record<string, unknown>> {
    return this.enterpriseIamService.createProvider(
      this.requireActorId(req),
      dto,
    );
  }

  @Patch('providers/:id')
  @RequirePermissions('tenant.settings.write')
  async updateProvider(
    @Req() req: EnterpriseIamRequest,
    @Param('id') id: string,
    @Body() dto: UpdateEnterpriseIdentityProviderDto,
  ): Promise<Record<string, unknown>> {
    return this.enterpriseIamService.updateProvider(
      this.requireActorId(req),
      id,
      dto,
    );
  }

  @Put('providers/:id/role-mappings')
  @RequirePermissions('tenant.settings.write')
  async updateRoleMappings(
    @Req() req: EnterpriseIamRequest,
    @Param('id') id: string,
    @Body() dto: UpdateEnterpriseRoleMappingsDto,
  ): Promise<Record<string, unknown>> {
    return this.enterpriseIamService.updateRoleMappings(
      this.requireActorId(req),
      id,
      dto,
    );
  }

  @Get('sync-jobs')
  @RequirePermissions('tenant.settings.read')
  async listSyncJobs(
    @Req() req: EnterpriseIamRequest,
    @Query() query: ListEnterpriseSyncJobsQueryDto,
  ): Promise<Record<string, unknown>[]> {
    return this.enterpriseIamService.listSyncJobs(
      this.requireActorId(req),
      query,
    );
  }

  @Post('providers/:id/sync-import')
  @RequirePermissions('tenant.settings.write')
  async createSyncImportJob(
    @Req() req: EnterpriseIamRequest,
    @Param('id') id: string,
    @Body() dto: CreateEnterpriseSyncImportJobDto,
  ): Promise<Record<string, unknown>> {
    return this.enterpriseIamService.createSyncImportJob(
      this.requireActorId(req),
      id,
      dto,
    );
  }

  private requireActorId(req: EnterpriseIamRequest): string {
    const actorId = req.user?.sub;
    if (!actorId) {
      throw new BadRequestException('Authenticated user is required');
    }
    return actorId;
  }
}
