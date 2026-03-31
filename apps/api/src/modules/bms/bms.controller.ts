import {
  Controller,
  Post,
  Param,
  Body,
  UnauthorizedException,
  Get,
  Query,
} from '@nestjs/common';
import { BmsService } from './bms.service';
import { PrismaService } from '../../prisma.service';

@Controller('v1/bms')
export class BmsController {
  constructor(
    private readonly bmsService: BmsService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('packs')
  async listPacks() {
    return this.prisma.batteryPack.findMany({
      orderBy: { updatedAt: 'desc' },
      take: 100,
    });
  }

  @Get('packs/:packId/telemetry')
  async getTelemetry(
    @Param('packId') packId: string,
    @Query('limit') limit?: string,
  ) {
    const takeAmount = limit ? parseInt(limit, 10) : 50;
    return this.prisma.batteryTelemetry.findMany({
      where: { packId },
      orderBy: { timestamp: 'desc' },
      take: takeAmount,
    });
  }

  @Post('packs/:packId/kill')
  async remoteKillPack(
    @Param('packId') packId: string,
    @Body() body: { stationId: string; adminToken: string },
  ) {
    // In a production environment, this should be guarded by robust NestJS Guards (e.g., RolesGuard)
    if (body.adminToken !== 'EVZONE_SECURE_ADMIN_TOKEN') {
      throw new UnauthorizedException(
        'You are not authorized to deploy a Remote Kill command.',
      );
    }

    if (!body.stationId) {
      throw new UnauthorizedException(
        'Target stationId is required to route the kill command.',
      );
    }

    await this.bmsService.dispatchRemoteKill(
      packId,
      body.stationId,
      'system-admin-user',
    );
    return {
      success: true,
      message: 'CRITICAL: BMS Kill Command executed over MQTT.',
    };
  }
}
