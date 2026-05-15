import { Global, Module } from '@nestjs/common';
import { TenantContextService } from './tenant-context.service';
import { TenantPrismaRoutingService } from './tenant-prisma-routing.service';
import { TenantRoutingConfigService } from './tenant-routing-config.service';
import { BatteryProviderContextService } from './battery-provider-context.service';

@Global()
@Module({
  providers: [
    TenantRoutingConfigService,
    TenantContextService,
    TenantPrismaRoutingService,
    BatteryProviderContextService,
  ],
  exports: [
    TenantRoutingConfigService,
    TenantContextService,
    TenantPrismaRoutingService,
    BatteryProviderContextService,
  ],
})
export class DatabaseModule {}
