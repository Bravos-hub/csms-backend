import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BillingController } from './billing-service.controller';
import { FinanceController } from './finance.controller';
import { SettlementsController } from './settlements.controller';
import { BillingService } from './billing-service.service';
import { CommerceService } from './commerce.service';
import { PaymentsModule } from '../payments/payments.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' }),
    PaymentsModule,
  ],
  controllers: [BillingController, FinanceController, SettlementsController],
  providers: [BillingService, CommerceService],
  exports: [BillingService, CommerceService],
})
export class BillingServiceModule {}
