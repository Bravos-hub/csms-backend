
import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { BillingService } from './billing-service.service';
import { JwtAuthGuard } from '../../modules/auth/jwt-auth.guard';

@Controller('finance')
@UseGuards(JwtAuthGuard)
export class FinanceController {
    constructor(private readonly billingService: BillingService) { }

    @Get('payments')
    async getPayments(@Query() query: any) {
        return this.billingService.getAllPayments(query);
    }
}
