import { Module } from '@nestjs/common';
import { WalletController } from './wallet.controller';
import { BillingServiceModule } from '../billing/billing-service.module';

@Module({
  imports: [BillingServiceModule],
  controllers: [WalletController],
})
export class WalletModule {}
