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
} from '@nestjs/common';
import { ApiTags, ApiCookieAuth } from '@nestjs/swagger';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { BatteryProviderGuard } from './battery-provider.guard';
import { BatteryProviderAccessService, ResolvedProviderScope } from './battery-provider-access.service';
import { BatteryProviderDashboardService } from './battery-provider-dashboard.service';
import { BatteryProviderPacksService } from './battery-provider-packs.service';
import { BatteryProviderCabinetsService } from './battery-provider-cabinets.service';
import { BatteryProviderSwapsService } from './battery-provider-swaps.service';
import { BatteryProviderAlertsService } from './battery-provider-alerts.service';
import { BatteryProviderMaintenanceService } from './battery-provider-maintenance.service';
import { BatteryProviderSlaService } from './battery-provider-sla.service';
import {
  ProviderOverviewQueryDto,
  PackListQueryDto,
  PackActionDto,
  CabinetListQueryDto,
  SwapListQueryDto,
  AlertListQueryDto,
  AlertActionDto,
  MaintenanceListQueryDto,
  CreateMaintenanceDto,
} from './dto/battery-provider.dto';

interface AuthenticatedRequest extends Request {
  user: { sub: string };
  providerScope: ResolvedProviderScope;
}

@ApiTags('Battery Provider Console')
@ApiCookieAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard, BatteryProviderGuard)
@Controller('cpo/battery-provider')
export class BatteryProvidersController {
  constructor(
    private readonly accessService: BatteryProviderAccessService,
    private readonly dashboardService: BatteryProviderDashboardService,
    private readonly packsService: BatteryProviderPacksService,
    private readonly cabinetsService: BatteryProviderCabinetsService,
    private readonly swapsService: BatteryProviderSwapsService,
    private readonly alertsService: BatteryProviderAlertsService,
    private readonly maintenanceService: BatteryProviderMaintenanceService,
    private readonly slaService: BatteryProviderSlaService,
  ) {}

  private getScope(req: AuthenticatedRequest): ResolvedProviderScope {
    return req.providerScope;
  }

  // Dashboard / Overview
  @Get('overview')
  @RequirePermissions('batteryProvider.dashboard.read')
  async getOverview(@Req() req: AuthenticatedRequest) {
    return this.dashboardService.getOverview(this.getScope(req));
  }

  @Get('kpis')
  @RequirePermissions('batteryProvider.dashboard.read')
  async getKpis(@Req() req: AuthenticatedRequest) {
    return this.dashboardService.getOverview(this.getScope(req));
  }

  // Packs
  @Get('packs')
  @RequirePermissions('batteryProvider.packs.read')
  async listPacks(
    @Req() req: AuthenticatedRequest,
    @Query() query: PackListQueryDto,
  ) {
    return this.packsService.listPacks(this.getScope(req), {
      stationId: query.stationId,
      cabinetId: query.cabinetId,
      status: query.status,
      minSoc: query.minSoc ? parseFloat(query.minSoc) : undefined,
      minSoh: query.minSoh ? parseFloat(query.minSoh) : undefined,
      faulted: query.faulted === 'true',
      page: query.page ? parseInt(query.page, 10) : undefined,
      limit: query.limit ? parseInt(query.limit, 10) : undefined,
    });
  }

  @Get('packs/:packId')
  @RequirePermissions('batteryProvider.packs.read')
  async getPack(
    @Req() req: AuthenticatedRequest,
    @Param('packId') packId: string,
  ) {
    return this.packsService.getPackDetail(this.getScope(req), packId);
  }

  @Get('packs/:packId/telemetry')
  @RequirePermissions('batteryProvider.telemetry.read')
  async getPackTelemetry(
    @Req() req: AuthenticatedRequest,
    @Param('packId') packId: string,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
  ) {
    return this.packsService.getPackTelemetry(this.getScope(req), packId, limit);
  }

  @Get('packs/:packId/swaps')
  @RequirePermissions('batteryProvider.packs.read')
  async getPackSwapHistory(
    @Req() req: AuthenticatedRequest,
    @Param('packId') packId: string,
  ) {
    return this.packsService.getPackSwapHistory(this.getScope(req), packId);
  }

  @Post('packs/:packId/quarantine')
  @RequirePermissions('batteryProvider.packs.manage')
  async quarantinePack(
    @Req() req: AuthenticatedRequest,
    @Param('packId') packId: string,
    @Body() body: PackActionDto,
  ) {
    return this.packsService.quarantinePack(
      this.getScope(req),
      packId,
      req.user.sub,
      body.reason,
    );
  }

  @Post('packs/:packId/release')
  @RequirePermissions('batteryProvider.packs.manage')
  async releasePack(
    @Req() req: AuthenticatedRequest,
    @Param('packId') packId: string,
    @Body() body: PackActionDto,
  ) {
    return this.packsService.releasePack(
      this.getScope(req),
      packId,
      req.user.sub,
      body.reason,
    );
  }

  @Post('packs/:packId/mark-inspected')
  @RequirePermissions('batteryProvider.packs.manage')
  async markInspected(
    @Req() req: AuthenticatedRequest,
    @Param('packId') packId: string,
    @Body() body: PackActionDto,
  ) {
    return this.packsService.markInspected(
      this.getScope(req),
      packId,
      req.user.sub,
      body.reason,
    );
  }

  @Post('packs/:packId/recommend-retirement')
  @RequirePermissions('batteryProvider.packs.manage')
  async recommendRetirement(
    @Req() req: AuthenticatedRequest,
    @Param('packId') packId: string,
    @Body() body: PackActionDto,
  ) {
    return this.packsService.recommendRetirement(
      this.getScope(req),
      packId,
      req.user.sub,
      body.reason,
    );
  }

  // Cabinets
  @Get('cabinets')
  @RequirePermissions('batteryProvider.cabinets.read')
  async listCabinets(
    @Req() req: AuthenticatedRequest,
    @Query() query: CabinetListQueryDto,
  ) {
    return this.cabinetsService.listCabinets(this.getScope(req), {
      stationId: query.stationId,
      status: query.status,
      page: query.page ? parseInt(query.page, 10) : undefined,
      limit: query.limit ? parseInt(query.limit, 10) : undefined,
    });
  }

  @Get('cabinets/:cabinetId')
  @RequirePermissions('batteryProvider.cabinets.read')
  async getCabinet(
    @Req() req: AuthenticatedRequest,
    @Param('cabinetId') cabinetId: string,
  ) {
    return this.cabinetsService.getCabinetDetail(this.getScope(req), cabinetId);
  }

  @Get('cabinets/:cabinetId/slots')
  @RequirePermissions('batteryProvider.cabinets.read')
  async getCabinetSlots(
    @Req() req: AuthenticatedRequest,
    @Param('cabinetId') cabinetId: string,
  ) {
    return this.cabinetsService.getCabinetSlots(this.getScope(req), cabinetId);
  }

  @Get('cabinets/:cabinetId/telemetry')
  @RequirePermissions('batteryProvider.telemetry.read')
  async getCabinetTelemetry(
    @Req() req: AuthenticatedRequest,
    @Param('cabinetId') cabinetId: string,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
  ) {
    return this.cabinetsService.getCabinetTelemetry(this.getScope(req), cabinetId, limit);
  }

  @Post('cabinets/:cabinetId/maintenance-mode')
  @RequirePermissions('batteryProvider.cabinets.manage')
  async setCabinetMaintenance(
    @Req() req: AuthenticatedRequest,
    @Param('cabinetId') cabinetId: string,
  ) {
    return this.cabinetsService.setMaintenanceMode(
      this.getScope(req),
      cabinetId,
      req.user.sub,
    );
  }

  @Post('cabinets/:cabinetId/slots/:slotId/disable')
  @RequirePermissions('batteryProvider.cabinets.manage')
  async disableSlot(
    @Req() req: AuthenticatedRequest,
    @Param('cabinetId') cabinetId: string,
    @Param('slotId') slotId: string,
  ) {
    return this.cabinetsService.setSlotEnabled(
      this.getScope(req),
      cabinetId,
      slotId,
      false,
      req.user.sub,
    );
  }

  @Post('cabinets/:cabinetId/slots/:slotId/enable')
  @RequirePermissions('batteryProvider.cabinets.manage')
  async enableSlot(
    @Req() req: AuthenticatedRequest,
    @Param('cabinetId') cabinetId: string,
    @Param('slotId') slotId: string,
  ) {
    return this.cabinetsService.setSlotEnabled(
      this.getScope(req),
      cabinetId,
      slotId,
      true,
      req.user.sub,
    );
  }

  // Swap Sessions
  @Get('swaps')
  @RequirePermissions('batteryProvider.swapSessions.read')
  async listSwaps(
    @Req() req: AuthenticatedRequest,
    @Query() query: SwapListQueryDto,
  ) {
    return this.swapsService.listSwaps(this.getScope(req), {
      stationId: query.stationId,
      cabinetId: query.cabinetId,
      stage: query.stage,
      dateFrom: query.dateFrom ? new Date(query.dateFrom) : undefined,
      dateTo: query.dateTo ? new Date(query.dateTo) : undefined,
      failedOnly: query.failedOnly === 'true',
      page: query.page ? parseInt(query.page, 10) : undefined,
      limit: query.limit ? parseInt(query.limit, 10) : undefined,
    });
  }

  @Get('swaps/:swapSessionId')
  @RequirePermissions('batteryProvider.swapSessions.read')
  async getSwap(
    @Req() req: AuthenticatedRequest,
    @Param('swapSessionId') swapSessionId: string,
  ) {
    return this.swapsService.getSwapDetail(this.getScope(req), swapSessionId);
  }

  @Get('swaps/:swapSessionId/technical-events')
  @RequirePermissions('batteryProvider.rawTelemetry.read')
  async getSwapTechnicalEvents(
    @Req() req: AuthenticatedRequest,
    @Param('swapSessionId') swapSessionId: string,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
  ) {
    return this.swapsService.getSwapTechnicalEvents(
      this.getScope(req),
      swapSessionId,
      limit,
    );
  }

  // Alerts
  @Get('alerts')
  @RequirePermissions('batteryProvider.alerts.read')
  async listAlerts(
    @Req() req: AuthenticatedRequest,
    @Query() query: AlertListQueryDto,
  ) {
    return this.alertsService.listAlerts(this.getScope(req), {
      status: query.status,
      severity: query.severity,
      category: query.category,
      page: query.page ? parseInt(query.page, 10) : undefined,
      limit: query.limit ? parseInt(query.limit, 10) : undefined,
    });
  }

  @Get('alerts/:alertId')
  @RequirePermissions('batteryProvider.alerts.read')
  async getAlert(
    @Req() req: AuthenticatedRequest,
    @Param('alertId') alertId: string,
  ) {
    return this.alertsService.getAlert(this.getScope(req), alertId);
  }

  @Post('alerts/:alertId/acknowledge')
  @RequirePermissions('batteryProvider.alerts.manage')
  async acknowledgeAlert(
    @Req() req: AuthenticatedRequest,
    @Param('alertId') alertId: string,
  ) {
    return this.alertsService.acknowledgeAlert(
      this.getScope(req),
      alertId,
      req.user.sub,
    );
  }

  @Post('alerts/:alertId/assign')
  @RequirePermissions('batteryProvider.alerts.manage')
  async assignAlert(
    @Req() req: AuthenticatedRequest,
    @Param('alertId') alertId: string,
    @Body() body: AlertActionDto,
  ) {
    if (!body.technicianId) {
      throw new Error('technicianId is required');
    }
    return this.alertsService.assignAlert(
      this.getScope(req),
      alertId,
      body.technicianId,
      req.user.sub,
    );
  }

  @Post('alerts/:alertId/escalate')
  @RequirePermissions('batteryProvider.alerts.manage')
  async escalateAlert(
    @Req() req: AuthenticatedRequest,
    @Param('alertId') alertId: string,
    @Body() body: AlertActionDto,
  ) {
    return this.alertsService.escalateAlert(
      this.getScope(req),
      alertId,
      req.user.sub,
      body.reason,
    );
  }

  @Post('alerts/:alertId/resolve')
  @RequirePermissions('batteryProvider.alerts.manage')
  async resolveAlert(
    @Req() req: AuthenticatedRequest,
    @Param('alertId') alertId: string,
    @Body() body: AlertActionDto,
  ) {
    return this.alertsService.resolveAlert(
      this.getScope(req),
      alertId,
      req.user.sub,
      body.reason,
    );
  }

  // Maintenance
  @Get('maintenance')
  @RequirePermissions('batteryProvider.maintenance.read')
  async listMaintenance(
    @Req() req: AuthenticatedRequest,
    @Query() query: MaintenanceListQueryDto,
  ) {
    return this.maintenanceService.listTickets(this.getScope(req), {
      status: query.status,
      assetType: query.assetType,
      page: query.page ? parseInt(query.page, 10) : undefined,
      limit: query.limit ? parseInt(query.limit, 10) : undefined,
    });
  }

  @Post('maintenance')
  @RequirePermissions('batteryProvider.maintenance.manage')
  async createMaintenance(
    @Req() req: AuthenticatedRequest,
    @Body() body: CreateMaintenanceDto,
  ) {
    return this.maintenanceService.createTicket(
      this.getScope(req),
      body,
      req.user.sub,
    );
  }

  @Patch('maintenance/:ticketId')
  @RequirePermissions('batteryProvider.maintenance.manage')
  async updateMaintenance(
    @Req() req: AuthenticatedRequest,
    @Param('ticketId') ticketId: string,
    @Body() body: { status?: string; assignedTo?: string; notes?: string },
  ) {
    return this.maintenanceService.updateTicket(
      this.getScope(req),
      ticketId,
      body,
      req.user.sub,
    );
  }

  @Post('maintenance/:ticketId/close')
  @RequirePermissions('batteryProvider.maintenance.manage')
  async closeMaintenance(
    @Req() req: AuthenticatedRequest,
    @Param('ticketId') ticketId: string,
    @Body() body: { notes?: string },
  ) {
    return this.maintenanceService.closeTicket(
      this.getScope(req),
      ticketId,
      req.user.sub,
      body.notes,
    );
  }

  // SLA
  @Get('sla')
  @RequirePermissions('batteryProvider.sla.read')
  async getSla(@Req() req: AuthenticatedRequest) {
    return this.slaService.getCurrentSla(this.getScope(req));
  }

  @Get('reports/availability')
  @RequirePermissions('batteryProvider.sla.read')
  async getAvailabilityReport(
    @Req() req: AuthenticatedRequest,
    @Query('dateFrom') dateFrom: string,
    @Query('dateTo') dateTo: string,
  ) {
    return this.slaService.getAvailabilityReport(
      this.getScope(req),
      new Date(dateFrom),
      new Date(dateTo),
    );
  }

  @Get('reports/faults')
  @RequirePermissions('batteryProvider.sla.read')
  async getFaultReport(
    @Req() req: AuthenticatedRequest,
    @Query('dateFrom') dateFrom: string,
    @Query('dateTo') dateTo: string,
  ) {
    return this.slaService.getFaultReport(
      this.getScope(req),
      new Date(dateFrom),
      new Date(dateTo),
    );
  }

  @Get('reports/swaps')
  @RequirePermissions('batteryProvider.sla.read')
  async getSwapReport(
    @Req() req: AuthenticatedRequest,
    @Query('dateFrom') dateFrom: string,
    @Query('dateTo') dateTo: string,
  ) {
    return this.slaService.getSwapReport(
      this.getScope(req),
      new Date(dateFrom),
      new Date(dateTo),
    );
  }
}
