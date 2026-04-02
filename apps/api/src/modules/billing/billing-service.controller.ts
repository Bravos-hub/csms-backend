import { Controller, Get, Post, Body, Req, Query } from '@nestjs/common';
import { BillingService } from './billing-service.service';
import { TopUpDto, GenerateInvoiceDto } from './dto/billing.dto';

type BillingRequest = {
  headers?: Record<string, string | string[] | undefined>;
};

@Controller()
export class BillingController {
  constructor(private readonly billingService: BillingService) {}

  private resolveUserId(req: BillingRequest): string {
    const headerValue = req.headers?.['x-user-id'];
    if (typeof headerValue === 'string' && headerValue.trim().length > 0) {
      return headerValue;
    }
    if (
      Array.isArray(headerValue) &&
      headerValue.length > 0 &&
      typeof headerValue[0] === 'string' &&
      headerValue[0].trim().length > 0
    ) {
      return headerValue[0];
    }
    return 'mock-user-id';
  }

  // Wallet
  @Get('wallet/balance')
  getBalance(@Req() req: BillingRequest) {
    const userId = this.resolveUserId(req);
    return this.billingService.getWalletBalance(userId);
  }

  @Get('wallet/transactions')
  getTransactions(
    @Req() req: BillingRequest,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const userId = this.resolveUserId(req);
    return this.billingService.getTransactions(userId, limit, offset);
  }

  @Post('wallet/topup')
  topUp(@Req() req: BillingRequest, @Body() dto: TopUpDto) {
    const userId = this.resolveUserId(req);
    return this.billingService.topUp(userId, dto);
  }

  // Billing
  @Get('billing/invoices')
  getInvoices(
    @Req() req: BillingRequest,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const userId = this.resolveUserId(req);
    return this.billingService.getInvoices(userId, limit, offset);
  }

  @Post('billing/invoices/generate')
  generateInvoice(@Body() dto: GenerateInvoiceDto) {
    return this.billingService.generateInvoice(dto);
  }

  @Get('tariffs')
  getTariffs() {
    return this.billingService.getTariffs();
  }
}
