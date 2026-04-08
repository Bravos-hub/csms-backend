import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { BillingService } from './billing-service.service';
import { TopUpDto, GenerateInvoiceDto } from './dto/billing.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CommerceService } from './commerce.service';
import { WalletTransactionQueryDto } from '../wallet/dto/wallet.dto';

type BillingRequest = Request & { user?: { sub?: string } };

@Controller()
@UseGuards(JwtAuthGuard)
export class BillingController {
  constructor(
    private readonly billingService: BillingService,
    private readonly commerceService: CommerceService,
  ) {}

  private resolveUserId(req: BillingRequest): string {
    const fromToken = req.user?.sub;
    if (typeof fromToken === 'string' && fromToken.trim().length > 0) {
      return fromToken;
    }

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
    throw new BadRequestException('Authenticated user is required');
  }

  // Wallet
  @Get('wallet/balance')
  getBalance(@Req() req: BillingRequest) {
    const userId = this.resolveUserId(req);
    return this.commerceService.getWallet(userId);
  }

  @Get('wallet/transactions')
  getTransactions(
    @Req() req: BillingRequest,
    @Query() query: WalletTransactionQueryDto,
  ) {
    const userId = this.resolveUserId(req);
    return this.commerceService.getWalletTransactions(userId, query);
  }

  @Post('wallet/topup')
  topUp(@Req() req: BillingRequest, @Body() dto: TopUpDto) {
    const userId = this.resolveUserId(req);
    return this.commerceService.topUp(userId, dto);
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
