import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth-service.module';
import { BillingServiceModule } from '../billing/billing-service.module';
import { VendorBaselineController } from './vendor-baseline.controller';
import { VendorBaselineService } from './vendor-baseline.service';

@Module({
  imports: [AuthModule, BillingServiceModule],
  controllers: [VendorBaselineController],
  providers: [VendorBaselineService],
  exports: [VendorBaselineService],
})
export class VendorBaselineModule {}
