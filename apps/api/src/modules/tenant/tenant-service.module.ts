import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TenantController } from './tenant-service.controller';
import { TenantService } from './tenant-service.service';

@Module({
  imports: [ConfigModule],
  controllers: [TenantController],
  providers: [TenantService],
})
export class TenantServiceModule {}
