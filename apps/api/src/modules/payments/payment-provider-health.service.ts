import { Injectable } from '@nestjs/common';
import {
  PaymentMarket,
  PaymentProvider,
  PaymentProviderHealth,
  PaymentProbeResult,
} from './payment.types';
import { PaymentProviderAdapterService } from './payment-provider-adapter.service';

export interface PaymentGatewayHealthResult {
  status: 'Operational' | 'Degraded' | 'Down';
  responseTime: number;
  metadata: {
    configuredProviders: number;
    healthyConfiguredProviders: number;
    marketCoverage: {
      china: boolean;
      global: boolean;
    };
    providers: PaymentProviderHealth[];
  };
}

@Injectable()
export class PaymentProviderHealthService {
  private readonly providers: Array<{
    provider: PaymentProvider;
    market: PaymentMarket;
  }> = [
    { provider: 'LIANLIAN', market: 'CHINA' },
    { provider: 'ALIPAY', market: 'CHINA' },
    { provider: 'STRIPE', market: 'GLOBAL' },
    { provider: 'FLUTTERWAVE', market: 'GLOBAL' },
  ];

  constructor(private readonly adapters: PaymentProviderAdapterService) {}

  async checkGatewayHealth(): Promise<PaymentGatewayHealthResult> {
    const started = Date.now();
    const checks = await Promise.all(
      this.providers.map(async (entry) => {
        const configured = this.adapters.isConfigured(entry.provider);
        if (!configured) {
          return {
            provider: entry.provider,
            market: entry.market,
            configured: false,
            healthy: false,
            responseTime: 0,
            message: 'Provider not configured',
          } as PaymentProviderHealth;
        }

        const probe = await this.adapters.probe(entry.provider);
        return this.mapProbe(entry.provider, entry.market, probe);
      }),
    );

    const configuredProviders = checks.filter(
      (check) => check.configured,
    ).length;
    const healthyConfiguredProviders = checks.filter(
      (check) => check.configured && check.healthy,
    ).length;

    const chinaCovered = checks.some(
      (check) => check.market === 'CHINA' && check.configured && check.healthy,
    );
    const globalCovered = checks.some(
      (check) => check.market === 'GLOBAL' && check.configured && check.healthy,
    );

    let status: PaymentGatewayHealthResult['status'];
    if (configuredProviders === 0 || !chinaCovered || !globalCovered) {
      status = 'Down';
    } else if (healthyConfiguredProviders === configuredProviders) {
      status = 'Operational';
    } else {
      status = 'Degraded';
    }

    return {
      status,
      responseTime: Date.now() - started,
      metadata: {
        configuredProviders,
        healthyConfiguredProviders,
        marketCoverage: {
          china: chinaCovered,
          global: globalCovered,
        },
        providers: checks,
      },
    };
  }

  private mapProbe(
    provider: PaymentProvider,
    market: PaymentMarket,
    probe: PaymentProbeResult,
  ): PaymentProviderHealth {
    return {
      provider,
      market,
      configured: true,
      healthy: probe.healthy,
      responseTime: probe.responseTime,
      statusCode: probe.statusCode,
      message: probe.message,
    };
  }
}
