import {
    Controller,
    Get,
    Post,
    Param,
    Body,
    Req,
    UseGuards,
    BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { AdminApprovalService } from './admin-approval.service';

@ApiTags('Admin - Applications')
@Controller('admin/applications')
export class AdminApprovalController {
    constructor(private readonly approvalService: AdminApprovalService) { }

    @Get('pending')
    @ApiOperation({ summary: 'Get all pending user applications' })
    @ApiResponse({ status: 200, description: 'List of pending applications' })
    async getPendingApplications() {
        return this.approvalService.getPendingApplications();
    }

    @Get(':id')
    @ApiOperation({ summary: 'Get application details' })
    @ApiResponse({ status: 200, description: 'Application details' })
    @ApiResponse({ status: 404, description: 'Application not found' })
    async getApplicationDetails(@Param('id') id: string) {
        return this.approvalService.getApplicationById(id);
    }

    @Post(':id/approve')
    @ApiOperation({ summary: 'Approve user application' })
    @ApiResponse({ status: 200, description: 'Application approved successfully' })
    @ApiResponse({ status: 403, description: 'Application already reviewed' })
    async approveApplication(
        @Param('id') id: string,
        @Req() req: any,
        @Body() body: { notes?: string },
    ) {
        // Get admin ID from request (from JWT middleware)
        const adminId = req.headers['x-user-id'] || 'mock-id';

        return this.approvalService.approveApplication(id, adminId, body.notes);
    }

    @Post(':id/reject')
    @ApiOperation({ summary: 'Reject user application' })
    @ApiResponse({ status: 200, description: 'Application rejected successfully' })
    @ApiResponse({ status: 400, description: 'Rejection reason required' })
    @ApiResponse({ status: 403, description: 'Application already reviewed' })
    async rejectApplication(
        @Param('id') id: string,
        @Req() req: any,
        @Body() body: { reason: string; notes?: string },
    ) {
        if (!body.reason) {
            throw new BadRequestException('Rejection reason is required');
        }

        // Get admin ID from request (from JWT middleware)
        const adminId = req.headers['x-user-id'] || 'mock-id';

        return this.approvalService.rejectApplication(
            id,
            adminId,
            body.reason,
            body.notes,
        );
    }
}
