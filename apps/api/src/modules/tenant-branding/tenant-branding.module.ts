import { Module } from '@nestjs/common';
import { TenantRoutingModule } from '../../common/tenant/tenant-routing.module';
import { MediaStorageService } from '../../common/services/media-storage.service';
import { AuthModule } from '../auth/auth-service.module';
import { TenantBrandingController } from './tenant-branding.controller';
import { PlatformTenantBrandingController } from './platform-tenant-branding.controller';
import { PublicTenantBrandingController } from './public-tenant-branding.controller';
import { TenantBrandingService } from './tenant-branding.service';

@Module({
  imports: [AuthModule, TenantRoutingModule],
  controllers: [
    TenantBrandingController,
    PlatformTenantBrandingController,
    PublicTenantBrandingController,
  ],
  providers: [TenantBrandingService, MediaStorageService],
  exports: [TenantBrandingService],
})
export class TenantBrandingModule {}
