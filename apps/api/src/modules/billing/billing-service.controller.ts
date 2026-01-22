import { Controller, Get, Post, Body, Param, Req } from '@nestjs/common';
import { BillingService } from './billing-service.service';
import { TopUpDto, GenerateInvoiceDto } from './dto/billing.dto';

@Controller()
export class BillingController {
  constructor(private readonly billingService: BillingService) { }

  // Wallet
  @Get('wallet/balance')
  getBalance(@Req() req: any) {
    const userId = req.headers['x-user-id'] || 'mock-user-id';
    return this.billingService.getWalletBalance(userId);
  }

  @Get('wallet/transactions')
  getTransactions(@Req() req: any) {
    const userId = req.headers['x-user-id'] || 'mock-user-id';
    return this.billingService.getTransactions(userId);
  }

  @Post('wallet/topup')
  topUp(@Req() req: any, @Body() dto: TopUpDto) {
    const userId = req.headers['x-user-id'] || 'mock-user-id';
    return this.billingService.topUp(userId, dto);
  }

  // Billing
  @Get('billing/invoices')
  getInvoices(@Req() req: any) {
    const userId = req.headers['x-user-id'] || 'mock-user-id';
    return this.billingService.getInvoices(userId);
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
