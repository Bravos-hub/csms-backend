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
  CreateProviderDto,
  CreateProviderSettlementEntryDto,
  ProviderListQueryDto,
  ProviderComplianceStatusesQueryDto,
  ProviderNotesBodyDto,
  ProviderRejectBodyDto,
  ProviderSettlementSummaryQueryDto,
  ProviderSuspendBodyDto,
  UpdateComplianceProfileDto,
  UpdateProviderDto,
} from './dto/providers.dto';
import { ProvidersService } from './providers.service';
import { ProviderSettlementsService } from './provider-settlements.service';
import { ProviderComplianceService } from './provider-compliance.service';

const MARKETPLACE_READER_ROLES: UserRole[] = Object.values(UserRole);
type ProviderRequestContext = {
  user?: {
    sub?: string;
  };
};

@Controller('providers')
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
export class ProvidersController {
  constructor(
    private readonly providersService: ProvidersService,
    private readonly providerSettlementsService: ProviderSettlementsService,
    private readonly providerComplianceService: ProviderComplianceService,
  ) {}

  private actorId(req: ProviderRequestContext): string | undefined {
    return req.user?.sub;
  }

  @Get('eligible')
  getEligible(
    @Query('ownerOrgId') ownerOrgId: string | undefined,
    @Req() req: ProviderRequestContext,
  ) {
    return this.providersService.getEligibleForOwner(
      ownerOrgId,
      this.actorId(req),
    );
  }

  @Get('settlements/summary')
  getSettlementSummary(
    @Query() query: ProviderSettlementSummaryQueryDto,
    @Req() req: ProviderRequestContext,
  ) {
    return this.providerSettlementsService.getSummary(query, this.actorId(req));
  }

  @Post('settlements/entries')
  createSettlementEntry(
    @Body() body: CreateProviderSettlementEntryDto,
    @Req() req: ProviderRequestContext,
  ) {
    return this.providerSettlementsService.createEntry(body, this.actorId(req));
  }

  @Get()
  getAll(
    @Query() query: ProviderListQueryDto,
    @Req() req: ProviderRequestContext,
  ) {
    return this.providersService.listProviders(query, this.actorId(req));
  }

  @Get('compliance-statuses')
  getComplianceStatuses(
    @Query() query: ProviderComplianceStatusesQueryDto,
    @Req() req: ProviderRequestContext,
  ) {
    return this.providerComplianceService.getProviderComplianceStatuses(
      query.providerIds,
      this.actorId(req),
    );
  }

  @Get('marketplace')
  @Roles(...MARKETPLACE_READER_ROLES)
  getMarketplaceProviders(
    @Query() query: ProviderListQueryDto,
    @Req() req: ProviderRequestContext,
  ) {
    return this.providersService.listProviders(query, this.actorId(req));
  }

  @Get('marketplace/:id')
  @Roles(...MARKETPLACE_READER_ROLES)
  getMarketplaceProviderById(
    @Param('id') id: string,
    @Req() req: ProviderRequestContext,
  ) {
    return this.providersService.getProviderById(id, this.actorId(req));
  }

  @Get(':id')
  getById(@Param('id') id: string, @Req() req: ProviderRequestContext) {
    return this.providersService.getProviderById(id, this.actorId(req));
  }

  @Get(':id/compliance-status')
  getComplianceStatus(
    @Param('id') id: string,
    @Req() req: ProviderRequestContext,
  ) {
    return this.providerComplianceService.getProviderComplianceStatus(
      id,
      this.actorId(req),
    );
  }

  @Post()
  create(@Body() body: CreateProviderDto, @Req() req: ProviderRequestContext) {
    return this.providersService.createProvider(body, this.actorId(req));
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() body: UpdateProviderDto,
    @Req() req: ProviderRequestContext,
  ) {
    return this.providersService.updateProvider(id, body, this.actorId(req));
  }

  @Patch(':id/compliance-profile')
  updateComplianceProfile(
    @Param('id') id: string,
    @Body() body: UpdateComplianceProfileDto,
    @Req() req: ProviderRequestContext,
  ) {
    return this.providersService.updateComplianceProfile(
      id,
      body,
      this.actorId(req),
    );
  }

  @Post(':id/submit')
  submit(@Param('id') id: string, @Req() req: ProviderRequestContext) {
    return this.providersService.submitForReview(id, this.actorId(req));
  }

  @Post(':id/approve')
  approve(
    @Param('id') id: string,
    @Body() body: ProviderNotesBodyDto,
    @Req() req: ProviderRequestContext,
  ) {
    return this.providersService.approveProvider(id, body, this.actorId(req));
  }

  @Post(':id/reject')
  reject(
    @Param('id') id: string,
    @Body() body: ProviderRejectBodyDto,
    @Req() req: ProviderRequestContext,
  ) {
    return this.providersService.rejectProvider(id, body, this.actorId(req));
  }

  @Post(':id/suspend')
  suspend(
    @Param('id') id: string,
    @Body() body: ProviderSuspendBodyDto,
    @Req() req: ProviderRequestContext,
  ) {
    return this.providersService.suspendProvider(id, body, this.actorId(req));
  }
}
