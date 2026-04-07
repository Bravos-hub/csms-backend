import { Global, Module } from '@nestjs/common';
import { TenantContextService } from './tenant-context.service';
import { TenantPrismaRoutingService } from './tenant-prisma-routing.service';
import { TenantRoutingConfigService } from './tenant-routing-config.service';

@Global()
@Module({
  providers: [
    TenantRoutingConfigService,
    TenantContextService,
    TenantPrismaRoutingService,
  ],
  exports: [
    TenantRoutingConfigService,
    TenantContextService,
    TenantPrismaRoutingService,
  ],
})
export class DatabaseModule {}
