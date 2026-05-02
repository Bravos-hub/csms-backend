import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { WebhooksService } from './webhooks.service';

@Controller('webhooks')
@UseGuards(JwtAuthGuard)
export class WebhooksController {
  constructor(private readonly webhooks: WebhooksService) {}

  @Get()
  getAll() {
    return this.webhooks.listWebhooks();
  }

  @Get(':id')
  getById(@Param('id') id: string) {
    return this.webhooks.getWebhookById(id);
  }

  @Get(':id/deliveries')
  getDeliveries(@Param('id') id: string, @Query('limit') limit?: string) {
    const parsed = limit ? Number.parseInt(limit, 10) : 50;
    return this.webhooks.listDeliveries(id, parsed);
  }

  @Post()
  create(@Body() payload: Record<string, unknown>) {
    return this.webhooks.createWebhook(payload);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() payload: Record<string, unknown>) {
    return this.webhooks.updateWebhook(id, payload);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.webhooks.removeWebhook(id);
  }

  @Post(':id/test')
  test(@Param('id') id: string) {
    return this.webhooks.testWebhook(id);
  }
}
