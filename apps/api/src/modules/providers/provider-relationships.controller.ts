import {
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
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import {
  CreateProviderRelationshipDto,
  RelationshipComplianceStatusesQueryDto,
  ProviderNotesBodyDto,
  ProviderRelationshipsQueryDto,
  RespondProviderRelationshipDto,
  SuspendProviderRelationshipDto,
  TerminateProviderRelationshipDto,
  UpdateComplianceProfileDto,
} from './dto/providers.dto';
import { ProviderRelationshipsService } from './provider-relationships.service';
import { ProviderComplianceService } from './provider-compliance.service';

type ProviderRequestContext = {
  user?: {
    sub?: string;
  };
};

@Controller('provider-relationships')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(
  UserRole.SUPER_ADMIN,
  UserRole.EVZONE_ADMIN,
  UserRole.EVZONE_OPERATOR,
  UserRole.STATION_OWNER,
  UserRole.STATION_OPERATOR,
  UserRole.SWAP_PROVIDER_ADMIN,
  UserRole.SWAP_PROVIDER_OPERATOR,
)
export class ProviderRelationshipsController {
  constructor(
    private readonly providerRelationshipsService: ProviderRelationshipsService,
    private readonly providerComplianceService: ProviderComplianceService,
  ) {}

  private actorId(req: ProviderRequestContext): string | undefined {
    return req.user?.sub;
  }

  @Get()
  getAll(
    @Query() query: ProviderRelationshipsQueryDto,
    @Req() req: ProviderRequestContext,
  ) {
    return this.providerRelationshipsService.listRelationships(
      query,
      this.actorId(req),
    );
  }

  @Post()
  create(
    @Body() body: CreateProviderRelationshipDto,
    @Req() req: ProviderRequestContext,
  ) {
    return this.providerRelationshipsService.requestRelationship(
      body,
      this.actorId(req),
    );
  }

  @Patch(':id/compliance-profile')
  updateComplianceProfile(
    @Param('id') id: string,
    @Body() body: UpdateComplianceProfileDto,
    @Req() req: ProviderRequestContext,
  ) {
    return this.providerRelationshipsService.updateComplianceProfile(
      id,
      body,
      this.actorId(req),
    );
  }

  @Get('compliance-statuses')
  getComplianceStatuses(
    @Query() query: RelationshipComplianceStatusesQueryDto,
    @Req() req: ProviderRequestContext,
  ) {
    return this.providerComplianceService.getRelationshipComplianceStatuses(
      query.relationshipIds,
      this.actorId(req),
    );
  }

  @Get(':id/compliance-status')
  getComplianceStatus(
    @Param('id') id: string,
    @Req() req: ProviderRequestContext,
  ) {
    return this.providerComplianceService.getRelationshipComplianceStatus(
      id,
      this.actorId(req),
    );
  }

  @Post(':id/respond')
  respond(
    @Param('id') id: string,
    @Body() body: RespondProviderRelationshipDto,
    @Req() req: ProviderRequestContext,
  ) {
    return this.providerRelationshipsService.respondToRelationship(
      id,
      body,
      this.actorId(req),
    );
  }

  @Post(':id/approve')
  approve(
    @Param('id') id: string,
    @Body() body: ProviderNotesBodyDto,
    @Req() req: ProviderRequestContext,
  ) {
    return this.providerRelationshipsService.approveRelationship(
      id,
      body,
      this.actorId(req),
    );
  }

  @Post(':id/suspend')
  suspend(
    @Param('id') id: string,
    @Body() body: SuspendProviderRelationshipDto,
    @Req() req: ProviderRequestContext,
  ) {
    return this.providerRelationshipsService.suspendRelationship(
      id,
      body,
      this.actorId(req),
    );
  }

  @Post(':id/terminate')
  terminate(
    @Param('id') id: string,
    @Body() body: TerminateProviderRelationshipDto,
    @Req() req: ProviderRequestContext,
  ) {
    return this.providerRelationshipsService.terminateRelationship(
      id,
      body,
      this.actorId(req),
    );
  }
}
