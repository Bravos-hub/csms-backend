import { Controller, Get, Post, Body, Patch, Param, UseGuards } from '@nestjs/common';
import { FeatureFlagsService } from './feature-flags.service';
import { JwtAuthGuard } from '../modules/auth/jwt-auth.guard';
import { RolesGuard } from '../modules/auth/roles.guard';
import { Roles } from '../modules/auth/roles.decorator';
import { UserRole } from '@prisma/client';
import { Public } from '../modules/auth/public.decorator';

@Controller('feature-flags')
@UseGuards(JwtAuthGuard, RolesGuard)
export class FeatureFlagsController {
    constructor(private readonly featureFlagsService: FeatureFlagsService) { }

    @Get()
    @Public()
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
