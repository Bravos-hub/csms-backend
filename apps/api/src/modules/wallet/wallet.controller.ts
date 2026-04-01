import { Body, Controller, Get, Post } from '@nestjs/common';

@Controller('wallet')
export class WalletController {
  @Get('balance')
  getBalance() {
    return { balance: 0, currency: 'USD' };
  }

  @Get('transactions')
  getTransactions() {
    return [];
  }

  @Post('topup')
  topUp(@Body() payload: Record<string, unknown>) {
    return { ...payload };
  }

  @Post('lock')
  lock() {
    return { message: 'locked' };
  }

  @Post('unlock')
  unlock() {
    return { message: 'unlocked' };
  }

  @Post('transfer')
  transfer(@Body() payload: Record<string, unknown>) {
    return { ...payload };
  }
}
