import { Module } from '@nestjs/common';
import { ApplicationsController } from './applications.controller';
import { ApplicationsService } from './applications.service';
import { BillingServiceModule } from '../billing/billing-service.module';
import { TenantProvisioningModule } from '../tenant-provisioning/tenant-provisioning.module';
import { TenantRbacModule } from '../tenant-rbac/tenant-rbac.module';
import { NotificationServiceModule } from '../notification/notification-service.module';

@Module({
  imports: [
    BillingServiceModule,
    TenantProvisioningModule,
    TenantRbacModule,
    NotificationServiceModule,
  ],
  controllers: [ApplicationsController],
  providers: [ApplicationsService],
  exports: [ApplicationsService],
})
export class ApplicationsModule {}
