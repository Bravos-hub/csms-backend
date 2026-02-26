import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { TechniciansService } from './technicians.service';
import { JwtAuthGuard } from '../modules/auth/jwt-auth.guard';

type AuthenticatedRequest = Request & {
  user?: {
    sub?: string;
  };
};

@Controller('technicians')
@UseGuards(JwtAuthGuard)
export class TechniciansController {
  constructor(private readonly techniciansService: TechniciansService) {}

  @Get('availability')
  async findAll() {
    return this.techniciansService.findAll();
  }

  @Post('status')
  async updateStatus(
    @Req() req: AuthenticatedRequest,
    @Body() updateDto: { status: string; location?: string },
  ) {
    return this.techniciansService.updateStatus(req.user?.sub ?? '', updateDto);
  }

  @Get('me/assignment')
  async getAssignment(@Req() req: AuthenticatedRequest) {
    return this.techniciansService.getAssignment(req.user?.sub ?? '');
  }

  @Get('me/jobs')
  async getJobs(@Req() req: AuthenticatedRequest) {
    return this.techniciansService.getJobs(req.user?.sub ?? '');
  }
}
