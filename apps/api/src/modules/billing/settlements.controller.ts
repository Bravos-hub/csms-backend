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
    status?: 'pending' | 'processing' | 'completed' | 'failed';
    startedAt?: string;
    finishedAt?: string;
    note?: string;
}

@ApiTags('Settlements')
@Controller('settlements')
@UseGuards(JwtAuthGuard)
export class SettlementsController {
    constructor(private readonly billingService: BillingService) { }

    @Get()
    @ApiOperation({ summary: 'Get all settlements' })
    @ApiResponse({ status: 200, description: 'List of settlements' })
    async getAll(
        @Query('status') status?: string,
        @Query('region') region?: string,
    ): Promise<SettlementRecord[]> {
        return this.billingService.getSettlements(status, region) as any;
    }
}
