import { Controller, Get, Post, Query, Param, Body } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery, ApiResponse } from '@nestjs/swagger';
import { AuditLogsService, type CreateAuditLogDto } from './audit-logs.service';

@ApiTags('audit-logs')
@Controller('audit-logs')
export class AuditLogsController {
    constructor(private readonly auditLogsService: AuditLogsService) { }

    @Get()
    @ApiOperation({ summary: 'Get audit logs with pagination and filters' })
    @ApiQuery({ name: 'actor', required: false })
    @ApiQuery({ name: 'action', required: false })
    @ApiQuery({ name: 'resource', required: false })
    @ApiQuery({ name: 'status', required: false })
    @ApiQuery({ name: 'startDate', required: false })
    @ApiQuery({ name: 'endDate', required: false })
    @ApiQuery({ name: 'page', required: false, type: Number })
    @ApiQuery({ name: 'limit', required: false, type: Number })
    @ApiResponse({ status: 200, description: 'Returns paginated audit logs' })
    async findAll(
        @Query('actor') actor?: string,
        @Query('action') action?: string,
        @Query('resource') resource?: string,
        @Query('status') status?: string,
        @Query('startDate') startDate?: string,
        @Query('endDate') endDate?: string,
        @Query('page') page?: string,
        @Query('limit') limit?: string,
    ) {
        return this.auditLogsService.findAll({
            actor,
            action,
            resource,
            status,
            startDate: startDate ? new Date(startDate) : undefined,
            endDate: endDate ? new Date(endDate) : undefined,
            page: page ? parseInt(page) : undefined,
            limit: limit ? parseInt(limit) : undefined,
        });
    }

    @Get('resource/:resource/:resourceId')
    @ApiOperation({ summary: 'Get audit logs for a specific resource' })
    @ApiResponse({ status: 200, description: 'Returns audit logs for the resource' })
    async findByResource(
        @Param('resource') resource: string,
        @Param('resourceId') resourceId: string,
    ) {
        return this.auditLogsService.findByResource(resource, resourceId);
    }

    @Get('actor/:actor')
    @ApiOperation({ summary: 'Get audit logs for a specific actor' })
    @ApiQuery({ name: 'limit', required: false, type: Number })
    @ApiResponse({ status: 200, description: 'Returns audit logs for the actor' })
    async findByActor(@Param('actor') actor: string, @Query('limit') limit?: string) {
        return this.auditLogsService.findByActor(actor, limit ? parseInt(limit) : undefined);
    }

    @Post()
    @ApiOperation({ summary: 'Create audit log entry' })
    @ApiResponse({ status: 201, description: 'Audit log created successfully' })
    async create(@Body() dto: CreateAuditLogDto) {
        return this.auditLogsService.create(dto);
    }
}
