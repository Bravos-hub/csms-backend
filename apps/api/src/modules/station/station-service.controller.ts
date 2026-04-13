import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Put,
  Query,
  Logger,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { EventPattern, Payload } from '@nestjs/microservices';
import { StationService } from './station-service.service';
import { KAFKA_TOPICS } from '../../contracts/kafka-topics';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import {
  CreateStationDto,
  UpdateStationDto,
  CreateChargePointDto,
  UpdateChargePointDto,
  ConfirmChargePointIdentityDto,
  SetChargePointPublicationDto,
  BindChargePointCertificateDto,
  UpdateChargePointBootstrapDto,
  RemoteStartChargePointCommandDto,
  UnlockChargePointCommandDto,
  RemoteStopChargePointCommandDto,
  UpdateFirmwareChargePointCommandDto,
  FirmwareEventHistoryQueryDto,
} from './dto/station.dto';

type AuthenticatedRequest = Request & {
  user?: {
    role?: string;
    canonicalRole?: string;
    permissions?: string[];
  };
};

@Controller('stations')
@UseGuards(JwtAuthGuard)
export class StationController {
  private readonly logger = new Logger(StationController.name);
  private readonly topicCounters = new Map<string, number>();

  constructor(private readonly stationService: StationService) {}

  @Post()
  create(@Body() createDto: CreateStationDto) {
    return this.stationService.createStation(createDto);
  }

  @Get()
  findAll(
    @Query('north') north?: string,
    @Query('south') south?: string,
    @Query('east') east?: string,
    @Query('west') west?: string,
    @Query('q') q?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Req() req?: AuthenticatedRequest,
  ) {
    const bounds = this.parseBounds(north, south, east, west);
    const pagination =
      limit !== undefined || offset !== undefined
        ? { limit, offset }
        : undefined;
    return this.stationService.findAllStations(bounds, q, pagination, req?.user);
  }

  @Get('nearby')
  findNearby(
    @Query('lat') lat: number,
    @Query('lng') lng: number,
    @Req() req?: AuthenticatedRequest,
  ) {
    return this.stationService.getNearbyStations(lat, lng, 10, req?.user);
  }

  @Get('code/:code')
  findByCode(@Param('code') code: string, @Req() req?: AuthenticatedRequest) {
    return this.stationService.findStationByCode(code, undefined, req?.user);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Req() req?: AuthenticatedRequest) {
    return this.stationService.findStationById(id, undefined, req?.user);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateDto: UpdateStationDto) {
    return this.stationService.updateStation(id, updateDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.stationService.removeStation(id);
  }

  @Get(':id/stats')
  getStats(@Param('id') id: string, @Req() req?: AuthenticatedRequest) {
    return this.stationService.getStationStats(id, req?.user);
  }

  @Get(':id/swaps-today')
  getSwaps(@Param('id') id: string, @Req() req?: AuthenticatedRequest) {
    return this.stationService.getSwapsToday(id, req?.user);
  }

  @Get(':id/reliability-history')
  getReliabilityHistory(@Param('id') id: string) {
    return this.stationService.getStatusHistory(id);
  }

  // Microservice EventHandler
  @EventPattern(KAFKA_TOPICS.legacyStationEvents)
  async handleLegacyOcppMessage(@Payload() message: any) {
    await this.consumeOcppMessage(KAFKA_TOPICS.legacyStationEvents, message);
  }

  @EventPattern(KAFKA_TOPICS.stationEvents)
  async handleStationEventMessage(@Payload() message: any) {
    await this.consumeOcppMessage(KAFKA_TOPICS.stationEvents, message);
  }

  private parseBounds(
    north?: string,
    south?: string,
    east?: string,
    west?: string,
  ) {
    const rawBounds = [north, south, east, west];
    const hasAnyBounds = rawBounds.some((value) => value !== undefined);
    const hasAllBounds = rawBounds.every((value) => value !== undefined);

    if (!hasAnyBounds || !hasAllBounds) {
      return undefined;
    }

    const parsedNorth = this.toFiniteNumber(north);
    const parsedSouth = this.toFiniteNumber(south);
    const parsedEast = this.toFiniteNumber(east);
    const parsedWest = this.toFiniteNumber(west);

    if (
      parsedNorth === undefined ||
      parsedSouth === undefined ||
      parsedEast === undefined ||
      parsedWest === undefined
    ) {
      return undefined;
    }

    return {
      north: Math.max(parsedNorth, parsedSouth),
      south: Math.min(parsedNorth, parsedSouth),
      east: Math.max(parsedEast, parsedWest),
      west: Math.min(parsedEast, parsedWest),
    };
  }

  private toFiniteNumber(value?: string): number | undefined {
    if (value === undefined || value.trim() === '') return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  private async consumeOcppMessage(topic: string, message: any): Promise<void> {
    const count = (this.topicCounters.get(topic) || 0) + 1;
    this.topicCounters.set(topic, count);
    if (count === 1 || count % 100 === 0) {
      this.logger.log(`Received ${count} station event(s) from topic ${topic}`);
    }
    await this.stationService.handleOcppMessage(message);
  }
}

@Controller('charge-points')
@UseGuards(JwtAuthGuard)
export class ChargePointController {
  constructor(private readonly stationService: StationService) {}

  @Get()
  findAll(
    @Query('stationId') stationId?: string,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Req() req?: AuthenticatedRequest,
  ) {
    return this.stationService.findAllChargePoints(
      { stationId, status },
      { limit, offset },
      req?.user,
    );
  }

  @Get('by-ocpp/:ocppId')
  findByOcppId(
    @Param('ocppId') ocppId: string,
    @Req() req?: AuthenticatedRequest,
  ) {
    return this.stationService.findChargePointByOcppId(
      ocppId,
      undefined,
      req?.user,
    );
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Req() req?: AuthenticatedRequest) {
    return this.stationService.findChargePointById(id, undefined, req?.user);
  }

  @Post()
  create(@Body() createDto: CreateChargePointDto) {
    return this.stationService.createChargePoint(createDto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateDto: UpdateChargePointDto) {
    return this.stationService.updateChargePoint(id, updateDto);
  }

  @Post(':id/identity/confirm')
  confirmIdentity(
    @Param('id') id: string,
    @Body() dto: ConfirmChargePointIdentityDto,
  ) {
    return this.stationService.confirmChargePointIdentity(id, dto);
  }

  @Get(':id/publication')
  getPublication(@Param('id') id: string, @Req() req?: AuthenticatedRequest) {
    return this.stationService.getChargePointPublication(id, req?.user);
  }

  @Put(':id/publication')
  setPublication(
    @Param('id') id: string,
    @Body() dto: SetChargePointPublicationDto,
  ) {
    return this.stationService.setChargePointPublication(id, dto.published);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.stationService.removeChargePoint(id);
  }

  @Post(':id/reboot')
  reboot(@Param('id') id: string) {
    return this.stationService.rebootChargePoint(id);
  }

  @Post(':id/commands/soft-reset')
  softReset(@Param('id') id: string) {
    return this.stationService.softResetChargePoint(id);
  }

  @Post(':id/commands/remote-start')
  remoteStart(
    @Param('id') id: string,
    @Body() dto: RemoteStartChargePointCommandDto,
  ) {
    return this.stationService.remoteStartChargePoint(id, dto);
  }

  @Post(':id/commands/unlock')
  unlock(@Param('id') id: string, @Body() dto: UnlockChargePointCommandDto) {
    return this.stationService.unlockConnector(id, dto);
  }

  @Post(':id/commands/remote-stop')
  remoteStop(
    @Param('id') id: string,
    @Body() dto: RemoteStopChargePointCommandDto,
  ) {
    return this.stationService.remoteStopChargePoint(id, dto);
  }

  @Post(':id/commands/pause')
  pauseChargePoint(@Param('id') id: string) {
    return this.stationService.pauseChargePoint(id);
  }

  @Post(':id/commands/resume')
  resumeChargePoint(@Param('id') id: string) {
    return this.stationService.resumeChargePoint(id);
  }

  @Post(':id/commands/update-firmware')
  updateFirmware(
    @Param('id') id: string,
    @Body() dto: UpdateFirmwareChargePointCommandDto,
  ) {
    return this.stationService.updateFirmware(id, dto);
  }

  @Get(':id/firmware/events')
  getFirmwareEvents(
    @Param('id') id: string,
    @Query() query: FirmwareEventHistoryQueryDto,
    @Req() req?: AuthenticatedRequest,
  ) {
    return this.stationService.getFirmwareEvents(id, query, req?.user);
  }

  @Get(':id/security')
  getSecurity(@Param('id') id: string, @Req() req?: AuthenticatedRequest) {
    return this.stationService.getChargePointSecurity(id, req?.user);
  }

  @Post(':id/security/certificate-bind')
  bindCertificate(
    @Param('id') id: string,
    @Body() dto: BindChargePointCertificateDto,
  ) {
    return this.stationService.bindChargePointCertificate(id, dto);
  }

  @Patch(':id/security/bootstrap')
  updateBootstrap(
    @Param('id') id: string,
    @Body() dto: UpdateChargePointBootstrapDto,
  ) {
    return this.stationService.updateChargePointBootstrap(id, dto);
  }
}
