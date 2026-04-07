import { Body, Controller, Get, Post } from '@nestjs/common';

@Controller('withdrawals')
export class WithdrawalsController {
  @Post()
  create(@Body() payload: Record<string, unknown>) {
    return { ...payload };
  }

  @Get()
  getAll() {
    return [];
  }
}
