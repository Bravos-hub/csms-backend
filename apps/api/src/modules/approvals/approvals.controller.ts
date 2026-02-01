import { Controller, Get, Post, Param, Body, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { ApprovalsService, type ApprovalType } from './approvals.service';

@ApiTags('approvals')
@Controller('approvals')
export class ApprovalsController {
    constructor(private readonly approvalsService: ApprovalsService) { }

    @Get()
    @ApiOperation({ summary: 'Get pending approvals' })
    @ApiQuery({ name: 'type', required: false, enum: ['KYC', 'ACCESS_REQUEST', 'DOCUMENT_VERIFICATION', 'TENANT_APPLICATION'] })
    @ApiResponse({ status: 200, description: 'Returns pending approvals' })
    async getPendingApprovals(@Query('type') type?: ApprovalType) {
        return this.approvalsService.getPendingApprovals({ type });
    }

    @Post('kyc/:userId/approve')
    @ApiOperation({ summary: 'Approve KYC verification' })
    @ApiResponse({ status: 200, description: 'KYC approved successfully' })
    async approveKyc(
        @Param('userId') userId: string,
        @Body() body: { reviewedBy: string; notes?: string },
    ) {
        return this.approvalsService.approveKyc(userId, body.reviewedBy, body.notes);
    }

    @Post('kyc/:userId/reject')
    @ApiOperation({ summary: 'Reject KYC verification' })
    @ApiResponse({ status: 200, description: 'KYC rejected successfully' })
    async rejectKyc(
        @Param('userId') userId: string,
        @Body() body: { reviewedBy: string; notes: string },
    ) {
        return this.approvalsService.rejectKyc(userId, body.reviewedBy, body.notes);
    }

    @Post('application/:applicationId/approve')
    @ApiOperation({ summary: 'Approve tenant application' })
    @ApiResponse({ status: 200, description: 'Application approved successfully' })
    async approveApplication(
        @Param('applicationId') applicationId: string,
        @Body() body: { reviewedBy: string; notes?: string },
    ) {
        return this.approvalsService.approveApplication(applicationId, body.reviewedBy, body.notes);
    }

    @Post('application/:applicationId/reject')
    @ApiOperation({ summary: 'Reject tenant application' })
    @ApiResponse({ status: 200, description: 'Application rejected successfully' })
    async rejectApplication(
        @Param('applicationId') applicationId: string,
        @Body() body: { reviewedBy: string; notes: string },
    ) {
        return this.approvalsService.rejectApplication(applicationId, body.reviewedBy, body.notes);
    }
}
