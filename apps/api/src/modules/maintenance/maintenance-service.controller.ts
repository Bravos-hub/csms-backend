import { Controller, Get, Post, Body, Patch, Param, Delete } from '@nestjs/common';
import { MaintenanceService } from './maintenance-service.service';
import { CreateIncidentDto, UpdateIncidentDto, CreateDispatchDto, CreateWebhookDto } from './dto/maintenance.dto';

@Controller()
export class MaintenanceController {
  constructor(private readonly maintenanceService: MaintenanceService) { }

  // Incidents
  @Post('incidents')
  createIncident(@Body() dto: CreateIncidentDto) {
    return this.maintenanceService.createIncident(dto);
  }

  @Get('incidents')
  getIncidents() {
    return this.maintenanceService.findAllIncidents();
  }

  @Get('incidents/:id')
  getIncident(@Param('id') id: string) {
    return this.maintenanceService.findIncidentById(id);
  }

  @Patch('incidents/:id')
  updateIncident(@Param('id') id: string, @Body() dto: UpdateIncidentDto) {
    return this.maintenanceService.updateIncident(id, dto);
  }

  // Dispatches
  @Post('dispatches')
  createDispatch(@Body() dto: CreateDispatchDto) {
    return this.maintenanceService.createDispatch(dto);
  }

  @Get('dispatches')
  getDispatches() {
    return this.maintenanceService.findAllDispatches();
  }
}

@Controller('webhooks')
export class WebhookController {
  constructor(private readonly maintenanceService: MaintenanceService) { }

  @Post()
  create(@Body() dto: CreateWebhookDto) {
    return this.maintenanceService.registerWebhook(dto);
  }

  @Get()
  findAll() {
    return this.maintenanceService.getWebhooks();
  }
}
