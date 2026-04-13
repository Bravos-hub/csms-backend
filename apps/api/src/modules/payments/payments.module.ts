import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PaymentMarketResolverService } from './payment-market-resolver.service';
import { PaymentOrchestrationService } from './payment-orchestration.service';
import { PaymentProviderAdapterService } from './payment-provider-adapter.service';
import { PaymentProviderHealthService } from './payment-provider-health.service';
import { PaymentSettlementService } from './payment-settlement.service';
import { PaymentWebhooksController } from './payment-webhooks.controller';
import { PaymentWebhooksService } from './payment-webhooks.service';

@Module({
  imports: [ConfigModule],
  controllers: [PaymentWebhooksController],
  providers: [
    PaymentMarketResolverService,
    PaymentOrchestrationService,
    PaymentProviderAdapterService,
    PaymentProviderHealthService,
    PaymentSettlementService,
    PaymentWebhooksService,
  ],
  exports: [
    PaymentMarketResolverService,
    PaymentOrchestrationService,
    PaymentProviderAdapterService,
    PaymentProviderHealthService,
    PaymentSettlementService,
  ],
})
export class PaymentsModule {}
