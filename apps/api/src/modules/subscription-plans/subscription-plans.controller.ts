import {
    Controller,
    Get,
    Post,
    Put,
    Delete,
    Body,
    Param,
    Query,
    HttpCode,
    HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { SubscriptionPlansService } from './subscription-plans.service';
import { CreateSubscriptionPlanDto } from './dto/create-subscription-plan.dto';
import { UpdateSubscriptionPlanDto } from './dto/update-subscription-plan.dto';

@ApiTags('subscription-plans')
@Controller('subscription-plans')
export class SubscriptionPlansController {
    constructor(private readonly plansService: SubscriptionPlansService) { }

    @Get()
    @ApiOperation({ summary: 'Get all subscription plans' })
    @ApiQuery({ name: 'role', required: false })
    @ApiQuery({ name: 'isActive', required: false, type: Boolean })
    @ApiQuery({ name: 'isPublic', required: false, type: Boolean })
    @ApiResponse({ status: 200, description: 'Returns all subscription plans' })
    async findAll(
        @Query('role') role?: string,
        @Query('isActive') isActive?: string,
        @Query('isPublic') isPublic?: string,
    ) {
        return this.plansService.findAll({
            role,
            isActive: isActive === 'true' ? true : isActive === 'false' ? false : undefined,
            isPublic: isPublic === 'true' ? true : isPublic === 'false' ? false : undefined,
        });
    }

    @Get(':id')
    @ApiOperation({ summary: 'Get subscription plan by ID' })
    @ApiResponse({ status: 200, description: 'Returns the subscription plan' })
    @ApiResponse({ status: 404, description: 'Plan not found' })
    async findOne(@Param('id') id: string) {
        return this.plansService.findOne(id);
    }

    @Get('code/:code')
    @ApiOperation({ summary: 'Get subscription plan by code' })
    @ApiResponse({ status: 200, description: 'Returns the subscription plan' })
    @ApiResponse({ status: 404, description: 'Plan not found' })
    async findByCode(@Param('code') code: string) {
        return this.plansService.findByCode(code);
    }

    @Post()
    @ApiOperation({ summary: 'Create a new subscription plan' })
    @ApiResponse({ status: 201, description: 'Plan created successfully' })
    @ApiResponse({ status: 409, description: 'Plan with this code already exists' })
    async create(@Body() dto: CreateSubscriptionPlanDto) {
        return this.plansService.create(dto);
    }

    @Put(':id')
    @ApiOperation({ summary: 'Update subscription plan' })
    @ApiResponse({ status: 200, description: 'Plan updated successfully' })
    @ApiResponse({ status: 404, description: 'Plan not found' })
    async update(@Param('id') id: string, @Body() dto: UpdateSubscriptionPlanDto) {
        return this.plansService.update(id, dto);
    }

    @Put(':id/toggle-active')
    @ApiOperation({ summary: 'Toggle plan active status' })
    @ApiResponse({ status: 200, description: 'Plan status toggled successfully' })
    @ApiResponse({ status: 404, description: 'Plan not found' })
    async toggleActive(@Param('id') id: string, @Body('isActive') isActive: boolean) {
        return this.plansService.toggleActive(id, isActive);
    }

    @Delete(':id')
    @HttpCode(HttpStatus.NO_CONTENT)
    @ApiOperation({ summary: 'Delete subscription plan' })
    @ApiResponse({ status: 204, description: 'Plan deleted successfully' })
    @ApiResponse({ status: 404, description: 'Plan not found' })
    @ApiResponse({ status: 409, description: 'Cannot delete plan with active subscriptions' })
    async delete(@Param('id') id: string) {
        await this.plansService.delete(id);
    }
}
