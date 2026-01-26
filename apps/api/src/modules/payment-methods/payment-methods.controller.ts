import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common'

@Controller('payment-methods')
export class PaymentMethodsController {
  @Get()
  getAll() {
    return []
  }

  @Post()
  create(@Body() payload: any) {
    return payload
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() payload: any) {
    return { id, ...payload }
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return { id }
  }

  @Post(':id/set-default')
  setDefault(@Param('id') id: string) {
    return { id }
  }
}
