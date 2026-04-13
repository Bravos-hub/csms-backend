import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { Public } from '../auth/public.decorator';
import { PaymentWebhooksService } from './payment-webhooks.service';

interface RawBodyRequest extends Request {
  rawBody?: string;
}

@Controller('payments/webhooks')
export class PaymentWebhooksController {
  constructor(private readonly webhooks: PaymentWebhooksService) {}

  @Public()
  @Post('stripe')
  @HttpCode(HttpStatus.OK)
  async handleStripe(
    @Req() req: RawBodyRequest,
    @Body() payload: Record<string, unknown>,
  ) {
    return this.webhooks.handleWebhook({
      provider: 'STRIPE',
      rawBody: req.rawBody || JSON.stringify(payload || {}),
      payload,
      headers: req.headers,
    });
  }

  @Public()
  @Post('flutterwave')
  @HttpCode(HttpStatus.OK)
  async handleFlutterwave(
    @Req() req: RawBodyRequest,
    @Body() payload: Record<string, unknown>,
  ) {
    return this.webhooks.handleWebhook({
      provider: 'FLUTTERWAVE',
      rawBody: req.rawBody || JSON.stringify(payload || {}),
      payload,
      headers: req.headers,
    });
  }

  @Public()
  @Post('alipay')
  @HttpCode(HttpStatus.OK)
  async handleAlipay(
    @Req() req: RawBodyRequest,
    @Body() payload: Record<string, unknown>,
  ) {
    return this.webhooks.handleWebhook({
      provider: 'ALIPAY',
      rawBody: req.rawBody || JSON.stringify(payload || {}),
      payload,
      headers: req.headers,
    });
  }

  @Public()
  @Post('lianlian')
  @HttpCode(HttpStatus.OK)
  async handleLianLian(
    @Req() req: RawBodyRequest,
    @Body() payload: Record<string, unknown>,
  ) {
    return this.webhooks.handleWebhook({
      provider: 'LIANLIAN',
      rawBody: req.rawBody || JSON.stringify(payload || {}),
      payload,
      headers: req.headers,
    });
  }
}
