import {
  BadRequestException,
  Body,
  Controller,
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
import { DeveloperPlatformService } from './developer-platform.service';
import {
  CreateDeveloperApiKeyDto,
  CreateDeveloperAppDto,
  DeveloperUsageQueryDto,
  ListDeveloperAppsQueryDto,
  RevokeDeveloperApiKeyDto,
  UpdateDeveloperAppDto,
} from './dto/developer-platform.dto';

type DeveloperPlatformRequest = Request & {
  user?: {
    sub?: string;
  };
};

@Controller('platform/developer/v1')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class DeveloperPlatformController {
  constructor(private readonly developerPlatform: DeveloperPlatformService) {}

  @Get('overview')
  @RequirePermissions('tenant.settings.read')
  async getOverview(
    @Req() req: DeveloperPlatformRequest,
  ): Promise<Record<string, unknown>> {
    return this.developerPlatform.getOverview(this.requireActorId(req));
  }

  @Get('apps')
  @RequirePermissions('tenant.settings.read')
  async listApps(
    @Req() req: DeveloperPlatformRequest,
    @Query() query: ListDeveloperAppsQueryDto,
  ): Promise<Record<string, unknown>[]> {
    return this.developerPlatform.listApps(this.requireActorId(req), query);
  }

  @Post('apps')
  @RequirePermissions('tenant.settings.write')
  async createApp(
    @Req() req: DeveloperPlatformRequest,
    @Body() dto: CreateDeveloperAppDto,
  ): Promise<Record<string, unknown>> {
    return this.developerPlatform.createApp(this.requireActorId(req), dto);
  }

  @Patch('apps/:id')
  @RequirePermissions('tenant.settings.write')
  async updateApp(
    @Req() req: DeveloperPlatformRequest,
    @Param('id') id: string,
    @Body() dto: UpdateDeveloperAppDto,
  ): Promise<Record<string, unknown>> {
    return this.developerPlatform.updateApp(this.requireActorId(req), id, dto);
  }

  @Post('apps/:id/keys')
  @RequirePermissions('tenant.settings.write')
  async createApiKey(
    @Req() req: DeveloperPlatformRequest,
    @Param('id') id: string,
    @Body() dto: CreateDeveloperApiKeyDto,
  ): Promise<Record<string, unknown>> {
    return this.developerPlatform.createApiKey(
      this.requireActorId(req),
      id,
      dto,
    );
  }

  @Post('keys/:id/revoke')
  @RequirePermissions('tenant.settings.write')
  async revokeApiKey(
    @Req() req: DeveloperPlatformRequest,
    @Param('id') id: string,
    @Body() dto: RevokeDeveloperApiKeyDto,
  ): Promise<Record<string, unknown>> {
    return this.developerPlatform.revokeApiKey(
      this.requireActorId(req),
      id,
      dto,
    );
  }

  @Get('usage')
  @RequirePermissions('tenant.settings.read')
  async getUsage(
    @Req() req: DeveloperPlatformRequest,
    @Query() query: DeveloperUsageQueryDto,
  ): Promise<Record<string, unknown>> {
    return this.developerPlatform.getUsage(this.requireActorId(req), query);
  }

  @Get('onboarding')
  @RequirePermissions('tenant.settings.read')
  async getOnboarding(
    @Req() req: DeveloperPlatformRequest,
  ): Promise<Record<string, unknown>> {
    return this.developerPlatform.getOnboarding(this.requireActorId(req));
  }

  private requireActorId(req: DeveloperPlatformRequest): string {
    const actorId = req.user?.sub;
    if (!actorId) {
      throw new BadRequestException('Authenticated user is required');
    }
    return actorId;
  }
}
