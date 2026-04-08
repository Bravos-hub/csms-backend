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
import { FleetService } from './fleet.service';
import {
  AssignFleetDriverTokenDto,
  CreateFleetAccountDto,
  CreateFleetDriverDto,
  CreateFleetDriverGroupDto,
  FleetListQueryDto,
  RevokeFleetDriverTokenDto,
  UpdateFleetAccountDto,
  UpdateFleetDriverDto,
  UpdateFleetDriverGroupDto,
} from './dto/fleet.dto';

type FleetRequest = Request & { user?: { sub?: string } };

@Controller('fleet')
@UseGuards(JwtAuthGuard)
export class FleetController {
  constructor(private readonly fleetService: FleetService) {}

  @Get('overview')
  getOverview(@Req() req: FleetRequest) {
    return this.fleetService.getOverview(this.resolveActorId(req));
  }

  @Get('accounts')
  listAccounts(@Req() req: FleetRequest, @Query() query: FleetListQueryDto) {
    return this.fleetService.listAccounts(this.resolveActorId(req), query);
  }

  @Post('accounts')
  createAccount(@Req() req: FleetRequest, @Body() body: CreateFleetAccountDto) {
    return this.fleetService.createAccount(this.resolveActorId(req), body);
  }

  @Patch('accounts/:id')
  updateAccount(
    @Req() req: FleetRequest,
    @Param('id') id: string,
    @Body() body: UpdateFleetAccountDto,
  ) {
    return this.fleetService.updateAccount(this.resolveActorId(req), id, body);
  }

  @Get('driver-groups')
  listDriverGroups(
    @Req() req: FleetRequest,
    @Query() query: FleetListQueryDto,
  ) {
    return this.fleetService.listDriverGroups(this.resolveActorId(req), query);
  }

  @Post('driver-groups')
  createDriverGroup(
    @Req() req: FleetRequest,
    @Body() body: CreateFleetDriverGroupDto,
  ) {
    return this.fleetService.createDriverGroup(this.resolveActorId(req), body);
  }

  @Patch('driver-groups/:id')
  updateDriverGroup(
    @Req() req: FleetRequest,
    @Param('id') id: string,
    @Body() body: UpdateFleetDriverGroupDto,
  ) {
    return this.fleetService.updateDriverGroup(
      this.resolveActorId(req),
      id,
      body,
    );
  }

  @Get('drivers')
  listDrivers(@Req() req: FleetRequest, @Query() query: FleetListQueryDto) {
    return this.fleetService.listDrivers(this.resolveActorId(req), query);
  }

  @Post('drivers')
  createDriver(@Req() req: FleetRequest, @Body() body: CreateFleetDriverDto) {
    return this.fleetService.createDriver(this.resolveActorId(req), body);
  }

  @Patch('drivers/:id')
  updateDriver(
    @Req() req: FleetRequest,
    @Param('id') id: string,
    @Body() body: UpdateFleetDriverDto,
  ) {
    return this.fleetService.updateDriver(this.resolveActorId(req), id, body);
  }

  @Post('drivers/:id/tokens')
  assignDriverToken(
    @Req() req: FleetRequest,
    @Param('id') id: string,
    @Body() body: AssignFleetDriverTokenDto,
  ) {
    return this.fleetService.assignDriverToken(
      this.resolveActorId(req),
      id,
      body,
    );
  }

  @Patch('drivers/:id/tokens/:tokenId/revoke')
  revokeDriverToken(
    @Req() req: FleetRequest,
    @Param('id') id: string,
    @Param('tokenId') tokenId: string,
    @Body() body: RevokeFleetDriverTokenDto,
  ) {
    return this.fleetService.revokeDriverToken(
      this.resolveActorId(req),
      id,
      tokenId,
      body,
    );
  }

  private resolveActorId(req: FleetRequest): string {
    const actorId = req.user?.sub;
    if (typeof actorId === 'string' && actorId.trim().length > 0) {
      return actorId;
    }

    const fallback = req.headers['x-user-id'];
    if (typeof fallback === 'string' && fallback.trim().length > 0) {
      return fallback.trim();
    }

    if (
      Array.isArray(fallback) &&
      typeof fallback[0] === 'string' &&
      fallback[0].trim().length > 0
    ) {
      return fallback[0].trim();
    }

    throw new BadRequestException('Authenticated user is required');
  }
}
