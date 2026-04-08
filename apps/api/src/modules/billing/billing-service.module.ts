import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BillingController } from './billing-service.controller';
import { FinanceController } from './finance.controller';
import { SettlementsController } from './settlements.controller';
import { BillingService } from './billing-service.service';
import { CommerceService } from './commerce.service';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' })],
  controllers: [BillingController, FinanceController, SettlementsController],
  providers: [BillingService, CommerceService],
  exports: [BillingService, CommerceService],
})
export class BillingServiceModule {}
