import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';

@Controller('payment-methods')
export class PaymentMethodsController {
  private toObjectPayload(payload: unknown): Record<string, unknown> {
    if (
      typeof payload === 'object' &&
      payload !== null &&
      !Array.isArray(payload)
    ) {
      return payload as Record<string, unknown>;
    }

    return { payload };
  }

  @Get()
  getAll() {
    return [];
  }

  @Post()
  create(@Body() payload: unknown) {
    return payload;
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() payload: unknown) {
    return { id, ...this.toObjectPayload(payload) };
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return { id };
  }

  @Post(':id/set-default')
  setDefault(@Param('id') id: string) {
    return { id };
  }
}
