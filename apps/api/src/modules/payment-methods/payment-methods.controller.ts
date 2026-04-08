import {
  BadRequestException,
  Body,
  Controller,
  Delete,
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
import { CommerceService } from '../billing/commerce.service';
import {
  CreatePaymentMethodDto,
  PaymentMethodListQueryDto,
  UpdatePaymentMethodDto,
} from './dto/payment-methods.dto';

@Controller('payment-methods')
@UseGuards(JwtAuthGuard)
export class PaymentMethodsController {
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

  @Get()
  getAll(
    @Req() req: Request & { user?: { sub?: string } },
    @Query() query: PaymentMethodListQueryDto,
  ) {
    return this.commerce.listPaymentMethods(
      this.resolveUserId(req),
      Boolean(query.includeInactive),
    );
  }

  @Post()
  create(
    @Req() req: Request & { user?: { sub?: string } },
    @Body() payload: CreatePaymentMethodDto,
  ) {
    return this.commerce.createPaymentMethod(this.resolveUserId(req), payload);
  }

  @Patch(':id')
  update(
    @Req() req: Request & { user?: { sub?: string } },
    @Param('id') id: string,
    @Body() payload: UpdatePaymentMethodDto,
  ) {
    return this.commerce.updatePaymentMethod(
      this.resolveUserId(req),
      id,
      payload,
    );
  }

  @Delete(':id')
  async remove(
    @Req() req: Request & { user?: { sub?: string } },
    @Param('id') id: string,
  ) {
    await this.commerce.revokePaymentMethod(this.resolveUserId(req), id);
    return { id, revoked: true };
  }

  @Post(':id/set-default')
  setDefault(
    @Req() req: Request & { user?: { sub?: string } },
    @Param('id') id: string,
  ) {
    return this.commerce.setDefaultPaymentMethod(this.resolveUserId(req), id);
  }
}
