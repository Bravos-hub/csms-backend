import { Controller, Get, Post, Body, UseGuards, Request } from '@nestjs/common';
import { TechniciansService } from './technicians.service';
import { JwtAuthGuard } from '../modules/auth/jwt-auth.guard';

@Controller('technicians')
@UseGuards(JwtAuthGuard)
export class TechniciansController {
    constructor(private readonly techniciansService: TechniciansService) { }

    @Get('availability')
    async findAll() {
        return this.techniciansService.findAll();
    }

    @Post('status')
    async updateStatus(@Request() req: any, @Body() updateDto: { status: string; location?: string }) {
        return this.techniciansService.updateStatus(req.user.id, updateDto);
    }

    @Get('me/assignment')
    async getAssignment(@Request() req: any) {
        return this.techniciansService.getAssignment(req.user.id);
    }

    @Get('me/jobs')
    async getJobs(@Request() req: any) {
        return this.techniciansService.getJobs(req.user.id);
    }
}
