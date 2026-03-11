import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { GeographyService } from './geography.service';
import { Request } from 'express';
import { UserRole, ZoneType } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import {
  CreateGeographicZoneDto,
  GetZonesQueryDto,
  UpdateGeographicZoneDto,
  UpdateGeographicZoneStatusDto,
} from './dto/geography.dto';

@ApiTags('Geography')
@Controller('geography')
export class GeographyController {
  constructor(private readonly geographyService: GeographyService) {}

  @Get('detect')
  @ApiOperation({ summary: 'Auto-detect location from IP address' })
  async detectLocation(@Req() req: Request) {
    const ip =
      (req.headers['x-forwarded-for'] as string) ||
      req.socket.remoteAddress ||
      '';
    return this.geographyService.detectLocationFromIp(ip);
  }

  @Get('reverse')
  @ApiOperation({ summary: 'Reverse geocode coordinates to an address' })
  @ApiQuery({ name: 'lat', required: true, type: Number })
  @ApiQuery({ name: 'lng', required: true, type: Number })
  async reverseGeocode(@Query('lat') lat: number, @Query('lng') lng: number) {
    return this.geographyService.reverseGeocode(Number(lat), Number(lng));
  }

  @Get('zones')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN, UserRole.EVZONE_ADMIN, UserRole.EVZONE_OPERATOR)
  @ApiOperation({ summary: 'Get geographic zones (hierarchical)' })
  @ApiQuery({
    name: 'parentId',
    required: false,
    description: 'ID of the parent zone (e.g. Continent ID to get Countries)',
  })
  @ApiQuery({ name: 'type', required: false, enum: ZoneType })
  @ApiQuery({ name: 'active', required: false, type: Boolean })
  async getZones(
    @Query() query: GetZonesQueryDto,
  ) {
    return this.geographyService.getZones(query);
  }

  @Get('zones/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN, UserRole.EVZONE_ADMIN, UserRole.EVZONE_OPERATOR)
  @ApiOperation({ summary: 'Get a single geographic zone' })
  getZoneById(@Param('id') id: string) {
    return this.geographyService.getZoneById(id);
  }

  @Post('zones')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN, UserRole.EVZONE_ADMIN)
  @ApiOperation({ summary: 'Create a geographic zone' })
  createZone(@Body() body: CreateGeographicZoneDto) {
    return this.geographyService.createZone(body);
  }

  @Patch('zones/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN, UserRole.EVZONE_ADMIN)
  @ApiOperation({ summary: 'Update a geographic zone' })
  updateZone(@Param('id') id: string, @Body() body: UpdateGeographicZoneDto) {
    return this.geographyService.updateZone(id, body);
  }

  @Patch('zones/:id/status')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN, UserRole.EVZONE_ADMIN)
  @ApiOperation({ summary: 'Activate or deactivate a geographic zone' })
  updateZoneStatus(
    @Param('id') id: string,
    @Body() body: UpdateGeographicZoneStatusDto,
  ) {
    return this.geographyService.setZoneStatus(id, body.isActive);
  }
}
