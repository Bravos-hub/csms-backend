import { BillingController } from './billing-service.controller';

describe('BillingController', () => {
  it('should be defined', () => {
    const controller = new BillingController({} as any);
    expect(controller).toBeDefined();
  });
});
