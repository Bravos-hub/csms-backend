import { Body, Controller, Get, Post } from '@nestjs/common'

@Controller('withdrawals')
export class WithdrawalsController {
  @Post()
  create(@Body() payload: any) {
    return payload
  }

  @Get()
  getAll() {
    return []
  }
}
