import { Module } from '@nestjs/common';
import { PaymentMethodsController } from './payment-methods.controller';
import { BillingServiceModule } from '../billing/billing-service.module';

@Module({
  imports: [BillingServiceModule],
  controllers: [PaymentMethodsController],
})
export class PaymentMethodsModule {}
