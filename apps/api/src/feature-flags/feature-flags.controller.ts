import { Controller, Get, Post, Body, Patch, Param, UseGuards } from '@nestjs/common';
import { FeatureFlagsService } from './feature-flags.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '@prisma/client';

@Controller('feature-flags')
@UseGuards(JwtAuthGuard, RolesGuard)
export class FeatureFlagsController {
    constructor(private readonly featureFlagsService: FeatureFlagsService) { }

    @Get()
    async findAll() {
        return this.featureFlagsService.findAll();
    }

    @Post()
    @Roles(UserRole.SUPER_ADMIN)
    async create(@Body() createDto: { key: string; description?: string; isEnabled?: boolean; rules?: any }) {
        return this.featureFlagsService.create(createDto);
    }

    @Patch(':key')
    @Roles(UserRole.SUPER_ADMIN)
    async update(@Param('key') key: string, @Body() updateDto: { isEnabled?: boolean; rules?: any }) {
        return this.featureFlagsService.update(key, updateDto);
    }
}
