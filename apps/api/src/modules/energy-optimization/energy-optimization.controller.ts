import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { PermissionsGuard } from '../auth/permissions.guard';
import { EnergyOptimizationService } from './energy-optimization.service';

type PlanPayload = Record<string, unknown>;
type RequestUser = {
  sub?: string;
  userId?: string;
};
type RequestWithUser = Request & {
  user?: RequestUser;
};

@Controller('energy-optimization')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class EnergyOptimizationController {
  constructor(private readonly optimization: EnergyOptimizationService) {}

  @Get('plans')
  @RequirePermissions('smart_charging.read')
  listPlans(
    @Query('stationId') stationId?: string,
    @Query('groupId') groupId?: string,
    @Query('state') state?: string,
  ) {
    return this.optimization.listPlans({ stationId, groupId, state });
  }

  @Get('plans/:id')
  @RequirePermissions('smart_charging.read')
  getPlan(@Param('id') id: string) {
    return this.optimization.getPlan(id);
  }

  @Post('plans')
  @RequirePermissions('smart_charging.write')
  createPlan(@Body() payload: PlanPayload, @Req() request: RequestWithUser) {
    return this.optimization.createPlan(payload, this.resolveActorId(request));
  }

  @Post('plans/:id/approve')
  @RequirePermissions('smart_charging.write')
  approvePlan(@Param('id') id: string, @Req() request: RequestWithUser) {
    return this.optimization.approvePlan(id, this.resolveActorId(request));
  }

  private resolveActorId(request: RequestWithUser): string | undefined {
    return request.user?.sub || request.user?.userId || undefined;
  }
}
