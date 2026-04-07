import { BillingController } from './billing-service.controller';
import { BillingService } from './billing-service.service';

describe('BillingController', () => {
  it('should be defined', () => {
    const billingService = {} as unknown as BillingService;
    const controller = new BillingController(billingService);
    expect(controller).toBeDefined();
  });
});
