import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Put,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { EnergyManagementService } from './energy-management.service';

type RequestUser = {
  sub?: string;
  userId?: string;
  orgId?: string;
  organizationId?: string;
};

type RequestWithUser = Request & {
  user?: RequestUser;
};

@Controller('energy-management')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class EnergyManagementController {
  constructor(private readonly energyManagement: EnergyManagementService) {}

  @Get('groups')
  @RequirePermissions('smart_charging.read')
  listGroups(
    @Query('stationId') stationId?: string,
    @Query('status') status?: string,
  ) {
    return this.energyManagement.listGroups({ stationId, status });
  }

  @Get('stations/:stationId/live-status')
  @RequirePermissions('smart_charging.read')
  getStationLiveStatus(@Param('stationId') stationId: string) {
    return this.energyManagement.listGroups({ stationId });
  }

  @Get('stations/:stationId/der-profile')
  @RequirePermissions('smart_charging.read')
  getStationDerProfile(@Param('stationId') stationId: string) {
    return this.energyManagement.getStationDerProfile(stationId);
  }

  @Put('stations/:stationId/der-profile')
  @RequirePermissions('smart_charging.write')
  upsertStationDerProfile(
    @Param('stationId') stationId: string,
    @Body() body: Record<string, unknown>,
    @Req() request: RequestWithUser,
  ) {
    return this.energyManagement.upsertStationDerProfile(
      stationId,
      body,
      this.resolveActorId(request),
    );
  }

  @Get('groups/:id')
  @RequirePermissions('smart_charging.read')
  getGroup(@Param('id') id: string) {
    return this.energyManagement.getGroup(id);
  }

  @Get('groups/:id/history')
  @RequirePermissions('smart_charging.read')
  getHistory(@Param('id') id: string, @Query('limit') limit?: string) {
    const parsedLimit = Number(limit);
    return this.energyManagement.getHistory(
      id,
      Number.isFinite(parsedLimit) ? parsedLimit : undefined,
    );
  }

  @Post('groups')
  @RequirePermissions('smart_charging.write')
  createGroup(@Body() body: Record<string, unknown>) {
    return this.energyManagement.createGroup(body);
  }

  @Patch('groups/:id')
  @RequirePermissions('smart_charging.write')
  updateGroup(@Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.energyManagement.updateGroup(id, body);
  }

  @Delete('groups/:id')
  @RequirePermissions('smart_charging.write')
  deleteGroup(@Param('id') id: string) {
    return this.energyManagement.deleteGroup(id);
  }

  @Post('groups/:id/activate')
  @RequirePermissions('smart_charging.write')
  activateGroup(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.energyManagement.activateGroup(id, {
      reason: this.readString(body.reason) || 'Manual activation',
    });
  }

  @Post('groups/:id/disable')
  @RequirePermissions('smart_charging.write')
  disableGroup(@Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.energyManagement.disableGroup(id, {
      reason: this.readString(body.reason) || 'Manual disable',
    });
  }

  @Put('groups/:id/memberships')
  @RequirePermissions('smart_charging.write')
  replaceMemberships(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ) {
    const memberships = Array.isArray(body.memberships)
      ? (body.memberships as Record<string, unknown>[])
      : [];
    return this.energyManagement.replaceMemberships(id, memberships);
  }

  @Post('groups/:id/telemetry')
  @RequirePermissions('smart_charging.write')
  ingestTelemetry(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.energyManagement.ingestTelemetry(id, body);
  }

  @Post('groups/:id/recalculate')
  @RequirePermissions('smart_charging.write')
  recalculateGroup(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.energyManagement.recalculateGroup(id, {
      dryRun: this.readBoolean(body.dryRun) ?? false,
      trigger: this.readString(body.trigger) || 'manual',
      reason: this.readString(body.reason) || 'Manual recalculate',
    });
  }

  @Post('stations/:stationId/recalculate')
  @RequirePermissions('smart_charging.write')
  recalculateStation(
    @Param('stationId') stationId: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.energyManagement.recalculateStation(
      stationId,
      this.readString(body.reason) || 'Manual station recalculate',
    );
  }

  @Post('groups/:id/overrides')
  @RequirePermissions('smart_charging.write')
  createOverride(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
    @Req() request: RequestWithUser,
  ) {
    return this.energyManagement.createOverride(
      id,
      body,
      this.resolveActorId(request),
    );
  }

  @Post('groups/:id/overrides/:overrideId/clear')
  @RequirePermissions('smart_charging.write')
  clearOverride(
    @Param('id') id: string,
    @Param('overrideId') overrideId: string,
    @Req() request: RequestWithUser,
  ) {
    return this.energyManagement.clearOverride(
      id,
      overrideId,
      this.resolveActorId(request),
    );
  }

  @Post('groups/:id/alerts/:alertId/acknowledge')
  @RequirePermissions('smart_charging.write')
  acknowledgeAlert(
    @Param('id') id: string,
    @Param('alertId') alertId: string,
    @Req() request: RequestWithUser,
  ) {
    return this.energyManagement.acknowledgeAlert(
      id,
      alertId,
      this.resolveActorId(request),
    );
  }

  @Post('groups/:id/simulate-meter-loss')
  @RequirePermissions('smart_charging.write')
  simulateMeterLoss(@Param('id') id: string, @Req() request: RequestWithUser) {
    if ((process.env.NODE_ENV || '').toLowerCase() === 'production') {
      throw new ForbiddenException('Meter loss simulation is disabled');
    }

    return this.energyManagement.simulateMeterLoss(
      id,
      this.resolveActorId(request),
    );
  }

  @Get('schedules')
  @RequirePermissions('smart_charging.read')
  listSchedules(
    @Query('stationId') stationId?: string,
    @Query('groupId') groupId?: string,
    @Query('status') status?: string,
  ) {
    return this.energyManagement.listSchedules({ stationId, groupId, status });
  }

  @Post('schedules')
  @RequirePermissions('smart_charging.write')
  createSchedule(
    @Body() body: Record<string, unknown>,
    @Req() request: RequestWithUser,
  ) {
    return this.energyManagement.createSchedule(
      body,
      this.resolveActorId(request),
    );
  }

  @Post('schedules/:id/approve')
  @RequirePermissions('smart_charging.write')
  approveSchedule(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
    @Req() request: RequestWithUser,
  ) {
    return this.energyManagement.approveSchedule(
      id,
      body,
      this.resolveActorId(request),
    );
  }

  @Get('plan-runs')
  @RequirePermissions('smart_charging.read')
  listPlanRuns(
    @Query('stationId') stationId?: string,
    @Query('groupId') groupId?: string,
    @Query('planId') planId?: string,
  ) {
    return this.energyManagement.listPlanRuns({ stationId, groupId, planId });
  }

  @Post('plan-runs')
  @RequirePermissions('smart_charging.write')
  createPlanRun(
    @Body() body: Record<string, unknown>,
    @Req() request: RequestWithUser,
  ) {
    return this.energyManagement.createPlanRun(
      body,
      this.resolveActorId(request),
    );
  }

  private resolveActorId(request: RequestWithUser): string | undefined {
    return request.user?.sub || request.user?.userId || undefined;
  }

  private readString(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  private readBoolean(value: unknown): boolean | undefined {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (['true', '1', 'yes', 'y', 'on'].includes(normalized)) return true;
      if (['false', '0', 'no', 'n', 'off'].includes(normalized)) return false;
    }
    return undefined;
  }
}
