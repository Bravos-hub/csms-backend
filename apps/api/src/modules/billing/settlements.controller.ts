import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { BillingService } from './billing-service.service';

export interface SettlementRecord {
  id: string;
  region?: string;
  org?: string;
  type?: string;
  amount?: number;
  currency?: string;
  status?: string;
  startedAt?: string;
  finishedAt?: string | null;
  note?: string | null;
}

@ApiTags('Settlements')
@Controller('settlements')
@UseGuards(JwtAuthGuard)
export class SettlementsController {
  constructor(private readonly billingService: BillingService) {}

  @Get()
  @ApiOperation({ summary: 'Get all settlements' })
  @ApiResponse({ status: 200, description: 'List of settlements' })
  getAll(
    @Query('status') status?: string,
    @Query('region') region?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ): Promise<SettlementRecord[]> {
    return this.billingService.getSettlements(status, region, limit, offset);
  }
}
