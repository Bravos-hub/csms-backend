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
} from '@nestjs/common'
import { UserRole } from '@prisma/client'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { RolesGuard } from '../auth/roles.guard'
import { Roles } from '../auth/roles.decorator'
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
} from './dto/providers.dto'
import { ProvidersService } from './providers.service'
import { ProviderSettlementsService } from './provider-settlements.service'
import { ProviderComplianceService } from './provider-compliance.service'

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

  @Get('eligible')
  getEligible(@Query('ownerOrgId') ownerOrgId: string | undefined, @Req() req: any) {
    return this.providersService.getEligibleForOwner(ownerOrgId, req.user?.sub)
  }

  @Get('settlements/summary')
  getSettlementSummary(@Query() query: ProviderSettlementSummaryQueryDto, @Req() req: any) {
    return this.providerSettlementsService.getSummary(query, req.user?.sub)
  }

  @Post('settlements/entries')
  createSettlementEntry(@Body() body: CreateProviderSettlementEntryDto, @Req() req: any) {
    return this.providerSettlementsService.createEntry(body, req.user?.sub)
  }

  @Get()
  getAll(@Query() query: ProviderListQueryDto, @Req() req: any) {
    return this.providersService.listProviders(query, req.user?.sub)
  }

  @Get('compliance-statuses')
  getComplianceStatuses(@Query() query: ProviderComplianceStatusesQueryDto, @Req() req: any) {
    return this.providerComplianceService.getProviderComplianceStatuses(query.providerIds, req.user?.sub)
  }

  @Get(':id')
  getById(@Param('id') id: string, @Req() req: any) {
    return this.providersService.getProviderById(id, req.user?.sub)
  }

  @Get(':id/compliance-status')
  getComplianceStatus(@Param('id') id: string, @Req() req: any) {
    return this.providerComplianceService.getProviderComplianceStatus(id, req.user?.sub)
  }

  @Post()
  create(@Body() body: CreateProviderDto, @Req() req: any) {
    return this.providersService.createProvider(body, req.user?.sub)
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: UpdateProviderDto, @Req() req: any) {
    return this.providersService.updateProvider(id, body, req.user?.sub)
  }

  @Patch(':id/compliance-profile')
  updateComplianceProfile(@Param('id') id: string, @Body() body: UpdateComplianceProfileDto, @Req() req: any) {
    return this.providersService.updateComplianceProfile(id, body, req.user?.sub)
  }

  @Post(':id/submit')
  submit(@Param('id') id: string, @Req() req: any) {
    return this.providersService.submitForReview(id, req.user?.sub)
  }

  @Post(':id/approve')
  approve(@Param('id') id: string, @Body() body: ProviderNotesBodyDto, @Req() req: any) {
    return this.providersService.approveProvider(id, body, req.user?.sub)
  }

  @Post(':id/reject')
  reject(@Param('id') id: string, @Body() body: ProviderRejectBodyDto, @Req() req: any) {
    return this.providersService.rejectProvider(id, body, req.user?.sub)
  }

  @Post(':id/suspend')
  suspend(@Param('id') id: string, @Body() body: ProviderSuspendBodyDto, @Req() req: any) {
    return this.providersService.suspendProvider(id, body, req.user?.sub)
  }
}
