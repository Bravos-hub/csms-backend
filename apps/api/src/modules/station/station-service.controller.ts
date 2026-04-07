import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  Logger,
} from '@nestjs/common';
import { EventPattern, Payload } from '@nestjs/microservices';
import { StationService } from './station-service.service';
import { KAFKA_TOPICS } from '../../contracts/kafka-topics';
import {
  CreateStationDto,
  UpdateStationDto,
  CreateChargePointDto,
  UpdateChargePointDto,
  BindChargePointCertificateDto,
  UpdateChargePointBootstrapDto,
  RemoteStartChargePointCommandDto,
  UnlockChargePointCommandDto,
  RemoteStopChargePointCommandDto,
} from './dto/station.dto';

@Controller('stations')
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
  ) {
    const bounds = this.parseBounds(north, south, east, west);
    const pagination =
      limit !== undefined || offset !== undefined
        ? { limit, offset }
        : undefined;
    return this.stationService.findAllStations(bounds, q, pagination);
  }

  @Get('nearby')
  findNearby(@Query('lat') lat: number, @Query('lng') lng: number) {
    return this.stationService.getNearbyStations(lat, lng, 10);
  }

  @Get('code/:code')
  findByCode(@Param('code') code: string) {
    return this.stationService.findStationByCode(code);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.stationService.findStationById(id);
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
  getStats(@Param('id') id: string) {
    return this.stationService.getStationStats(id);
  }

  @Get(':id/swaps-today')
  getSwaps(@Param('id') id: string) {
    return this.stationService.getSwapsToday(id);
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
export class ChargePointController {
  constructor(private readonly stationService: StationService) {}

  @Get()
  findAll(
    @Query('stationId') stationId?: string,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.stationService.findAllChargePoints(
      { stationId, status },
      { limit, offset },
    );
  }

  @Get('by-ocpp/:ocppId')
  findByOcppId(@Param('ocppId') ocppId: string) {
    return this.stationService.findChargePointByOcppId(ocppId);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.stationService.findChargePointById(id);
  }

  @Post()
  create(@Body() createDto: CreateChargePointDto) {
    return this.stationService.createChargePoint(createDto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateDto: UpdateChargePointDto) {
    return this.stationService.updateChargePoint(id, updateDto);
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

  @Get(':id/security')
  getSecurity(@Param('id') id: string) {
    return this.stationService.getChargePointSecurity(id);
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
