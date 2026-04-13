import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
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

  private assertAuthenticatedUserId(req: AuthenticatedRequest): string {
    const userId = req.user?.sub;
    if (!userId) {
      throw new BadRequestException('Authenticated user is required');
    }
    return userId;
  }

  @Get('availability')
  async findAll() {
    return this.techniciansService.findAll();
  }

  @Post('status')
  async updateStatus(
    @Req() req: AuthenticatedRequest,
    @Body() updateDto: { status: string; location?: string },
  ) {
    return this.techniciansService.updateStatus(
      this.assertAuthenticatedUserId(req),
      updateDto,
    );
  }

  @Get('me/assignment')
  async getAssignment(@Req() req: AuthenticatedRequest) {
    return this.techniciansService.getAssignment(
      this.assertAuthenticatedUserId(req),
    );
  }

  @Get('me/jobs')
  async getJobs(@Req() req: AuthenticatedRequest) {
    return this.techniciansService.getJobs(this.assertAuthenticatedUserId(req));
  }
}
