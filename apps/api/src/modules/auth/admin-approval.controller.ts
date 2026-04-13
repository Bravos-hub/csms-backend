import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Req,
  BadRequestException,
  GoneException,
} from '@nestjs/common';
import type { Request } from 'express';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { AdminApprovalService } from './admin-approval.service';

type AuthHeaderRequest = Request & { user?: { sub?: string } };

@ApiTags('Admin - Applications')
@Controller('admin/applications')
export class AdminApprovalController {
  constructor(private readonly approvalService: AdminApprovalService) {}

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
  @ApiResponse({
    status: 200,
    description: 'Application approved successfully',
  })
  @ApiResponse({ status: 403, description: 'Application already reviewed' })
  approveApplication(
    @Param('id') id: string,
    @Req() req: AuthHeaderRequest,
    @Body() body: { notes?: string },
  ) {
    void id;
    void req;
    void body;
    throw new GoneException(
      'Legacy user application approvals are deprecated. Use /applications canonical onboarding APIs.',
    );
  }

  @Post(':id/reject')
  @ApiOperation({ summary: 'Reject user application' })
  @ApiResponse({
    status: 200,
    description: 'Application rejected successfully',
  })
  @ApiResponse({ status: 400, description: 'Rejection reason required' })
  @ApiResponse({ status: 403, description: 'Application already reviewed' })
  rejectApplication(
    @Param('id') id: string,
    @Req() req: AuthHeaderRequest,
    @Body() body: { reason: string; notes?: string },
  ) {
    void id;
    void req;
    if (!body.reason) {
      throw new BadRequestException('Rejection reason is required');
    }
    throw new GoneException(
      'Legacy user application approvals are deprecated. Use /applications canonical onboarding APIs.',
    );
  }
}
