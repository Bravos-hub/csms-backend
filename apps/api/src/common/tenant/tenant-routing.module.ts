import { Global, Module } from '@nestjs/common';
import { TenantDirectoryService } from './tenant-directory.service';
import { TenantResolutionService } from './tenant-resolution.service';

@Global()
@Module({
  providers: [TenantDirectoryService, TenantResolutionService],
  exports: [TenantDirectoryService, TenantResolutionService],
})
export class TenantRoutingModule {}
