import { Module } from '@nestjs/common';
import { TenantRoutingModule } from '../../common/tenant/tenant-routing.module';
import { AuthModule } from '../auth/auth-service.module';
import { DeveloperApiKeyGuard } from './developer-api-key.guard';
import { DeveloperPlatformController } from './developer-platform.controller';
import { DeveloperPlatformService } from './developer-platform.service';
import { DeveloperPublicController } from './developer-public.controller';

@Module({
  imports: [AuthModule, TenantRoutingModule],
  controllers: [DeveloperPlatformController, DeveloperPublicController],
  providers: [DeveloperPlatformService, DeveloperApiKeyGuard],
})
export class DeveloperPlatformModule {}
