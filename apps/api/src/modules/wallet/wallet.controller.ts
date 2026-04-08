import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Public } from '../auth/public.decorator';
import { CommerceService } from '../billing/commerce.service';
import {
  CreatePaymentIntentDto,
  GuestCheckoutDto,
  ReconcilePaymentIntentDto,
  WalletDebitDto,
  WalletLockDto,
  WalletRefundDto,
  WalletTopUpDto,
  WalletTransactionQueryDto,
  WalletTransferDto,
} from './dto/wallet.dto';

@Controller('wallet')
@UseGuards(JwtAuthGuard)
export class WalletController {
  constructor(private readonly commerce: CommerceService) {}

  private resolveUserId(req: Request & { user?: { sub?: string } }): string {
    const fromToken = req.user?.sub;
    if (typeof fromToken === 'string' && fromToken.trim().length > 0) {
      return fromToken;
    }

    const fromHeader = req.headers['x-user-id'];
    if (typeof fromHeader === 'string' && fromHeader.trim().length > 0) {
      return fromHeader.trim();
    }

    if (
      Array.isArray(fromHeader) &&
      fromHeader.length > 0 &&
      typeof fromHeader[0] === 'string' &&
      fromHeader[0].trim().length > 0
    ) {
      return fromHeader[0].trim();
    }

    throw new BadRequestException('Authenticated user is required');
  }

  @Get('balance')
  getBalance(@Req() req: Request & { user?: { sub?: string } }) {
    return this.commerce.getWallet(this.resolveUserId(req));
  }

  @Get('transactions')
  getTransactions(
    @Req() req: Request & { user?: { sub?: string } },
    @Query() query: WalletTransactionQueryDto,
  ) {
    return this.commerce.getWalletTransactions(this.resolveUserId(req), query);
  }

  @Post('topup')
  topUp(
    @Req() req: Request & { user?: { sub?: string } },
    @Body() payload: WalletTopUpDto,
  ) {
    return this.commerce.topUp(this.resolveUserId(req), payload);
  }

  @Post('debit')
  debit(
    @Req() req: Request & { user?: { sub?: string } },
    @Body() payload: WalletDebitDto,
  ) {
    return this.commerce.debit(this.resolveUserId(req), payload);
  }

  @Post('refund')
  refund(
    @Req() req: Request & { user?: { sub?: string } },
    @Body() payload: WalletRefundDto,
  ) {
    return this.commerce.refund(this.resolveUserId(req), payload);
  }

  @Post('lock')
  lock(
    @Req() req: Request & { user?: { sub?: string } },
    @Body() payload: WalletLockDto,
  ) {
    return this.commerce.lockWallet(this.resolveUserId(req), payload.reason);
  }

  @Post('unlock')
  unlock(@Req() req: Request & { user?: { sub?: string } }) {
    return this.commerce.unlockWallet(this.resolveUserId(req));
  }

  @Post('transfer')
  transfer(
    @Req() req: Request & { user?: { sub?: string } },
    @Body() payload: WalletTransferDto,
  ) {
    return this.commerce.transfer(this.resolveUserId(req), payload);
  }

  @Post('payment-intents')
  createPaymentIntent(
    @Req() req: Request & { user?: { sub?: string } },
    @Body() payload: CreatePaymentIntentDto,
  ) {
    return this.commerce.createPaymentIntent(this.resolveUserId(req), payload);
  }

  @Get('payment-intents/:id')
  getPaymentIntent(
    @Req() req: Request & { user?: { sub?: string } },
    @Param('id') id: string,
  ) {
    void req;
    return this.commerce.getPaymentIntent(id);
  }

  @Patch('payment-intents/:id/reconcile')
  reconcilePaymentIntent(
    @Req() req: Request & { user?: { sub?: string } },
    @Param('id') id: string,
    @Body() payload: ReconcilePaymentIntentDto,
  ) {
    void req;
    return this.commerce.reconcilePaymentIntent(id, payload);
  }

  @Public()
  @Post('guest-checkout')
  guestCheckout(@Body() payload: GuestCheckoutDto) {
    return this.commerce.createGuestCheckoutIntent(payload);
  }
}
