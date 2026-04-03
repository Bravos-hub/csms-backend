import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth-service.module';
import { TenantProvisioningModule } from '../tenant-provisioning/tenant-provisioning.module';
import { PlatformController } from './platform.controller';
import { PlatformService } from './platform.service';

@Module({
  imports: [AuthModule, TenantProvisioningModule],
  controllers: [PlatformController],
  providers: [PlatformService],
})
export class PlatformModule {}
