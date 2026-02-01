import { Controller, Get, Post, Body, UseGuards, Request } from '@nestjs/common';
import { TechniciansService } from './technicians.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('technicians')
@UseGuards(JwtAuthGuard)
export class TechniciansController {
    constructor(private readonly techniciansService: TechniciansService) { }

    @Get('availability')
    async findAll() {
        return this.techniciansService.findAll();
    }

    @Post('status')
    async updateStatus(@Request() req, @Body() updateDto: { status: string; location?: string }) {
        return this.techniciansService.updateStatus(req.user.id, updateDto);
    }
}
