import { Controller, Get, Query, Req } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { GeographyService } from './geography.service';
import { Request } from 'express';
import { ZoneType } from '@prisma/client';

@ApiTags('Geography')
@Controller('geography')
export class GeographyController {
    constructor(private readonly geographyService: GeographyService) { }

    @Get('detect')
    @ApiOperation({ summary: 'Auto-detect location from IP address' })
    async detectLocation(@Req() req: Request) {
        const ip = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || '';
        return this.geographyService.detectLocationFromIp(ip);
    }

    @Get('reverse')
    @ApiOperation({ summary: 'Reverse geocode coordinates to an address' })
    @ApiQuery({ name: 'lat', required: true, type: Number })
    @ApiQuery({ name: 'lng', required: true, type: Number })
    async reverseGeocode(
        @Query('lat') lat: number,
        @Query('lng') lng: number
    ) {
        return this.geographyService.reverseGeocode(Number(lat), Number(lng));
    }

    @Get('zones')
    @ApiOperation({ summary: 'Get geographic zones (hierarchical)' })
    @ApiQuery({ name: 'parentId', required: false, description: 'ID of the parent zone (e.g. Continent ID to get Countries)' })
    @ApiQuery({ name: 'type', required: false, enum: ZoneType })
    async getZones(
        @Query('parentId') parentId?: string,
        @Query('type') type?: ZoneType
    ) {
        // Treat string 'null' or empty as actual null
        const parentIdVal = parentId === 'null' || parentId === '' ? null : parentId;
        return this.geographyService.getZones(parentIdVal, type);
    }
}
