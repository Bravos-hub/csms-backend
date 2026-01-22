import { Controller, Get, Query } from '@nestjs/common';
import { TenantService } from './tenant-service.service';

@Controller('tenants')
export class TenantController {
  constructor(private readonly tenantService: TenantService) { }

  @Get()
  findAll(@Query('siteId') siteId?: string) {
    return this.tenantService.findAll(siteId);
  }
}
