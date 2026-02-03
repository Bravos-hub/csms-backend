import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

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
    @Get()
    @ApiOperation({ summary: 'Get all settlements' })
    @ApiResponse({ status: 200, description: 'List of settlements' })
    async getAll(
        @Query('status') status?: string,
        @Query('region') region?: string,
    ): Promise<SettlementRecord[]> {
        // Mock data for now - replace with actual service call
        const mockSettlements: SettlementRecord[] = [
            {
                id: '1',
                region: 'North America',
                org: 'EV Station Group A',
                type: 'Monthly',
                amount: 125000,
                currency: 'USD',
                status: 'completed',
                startedAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
                finishedAt: new Date().toISOString(),
                note: 'Regular monthly settlement',
            },
            {
                id: '2',
                region: 'Europe',
                org: 'ChargePoint EU',
                type: 'Monthly',
                amount: 98000,
                currency: 'EUR',
                status: 'processing',
                startedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
                note: 'Processing settlement',
            },
            {
                id: '3',
                region: 'Asia Pacific',
                org: 'APAC Charging Network',
                type: 'Bi-weekly',
                amount: 45000,
                currency: 'USD',
                status: 'pending',
                startedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
                note: 'Awaiting approval',
            },
        ];

        // Filter by status if provided
        let filtered = mockSettlements;
        if (status) {
            filtered = filtered.filter(s => s.status === status);
        }
        if (region) {
            filtered = filtered.filter(s => s.region?.toLowerCase().includes(region.toLowerCase()));
        }

        return filtered;
    }
}
