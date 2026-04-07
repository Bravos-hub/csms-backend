import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth-service.module';
import { TenantRbacController } from './tenant-rbac.controller';
import { TenantRbacService } from './tenant-rbac.service';

@Module({
  imports: [AuthModule],
  controllers: [TenantRbacController],
  providers: [TenantRbacService],
  exports: [TenantRbacService],
})
export class TenantRbacModule {}
