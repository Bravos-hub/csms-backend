import { Controller, Get, Post, Body, Patch, Param, Delete, Put, Query } from '@nestjs/common';
import { EventPattern, Payload } from '@nestjs/microservices';
import { StationService } from './station-service.service';
import { CreateStationDto, UpdateStationDto, CreateChargePointDto, UpdateChargePointDto } from './dto/station.dto';

@Controller('stations')
export class StationController {
  constructor(private readonly stationService: StationService) { }

  @Post()
  create(@Body() createDto: CreateStationDto) {
    return this.stationService.createStation(createDto);
  }

  @Get()
  findAll() {
    return this.stationService.findAllStations();
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

  // Microservice EventHandler
  @EventPattern('ocpp.message')
  async handleOcppMessage(@Payload() message: any) {
    await this.stationService.handleOcppMessage(message);
  }
}

@Controller('charge-points')
export class ChargePointController {
  constructor(private readonly stationService: StationService) { }

  @Get()
  findAll() {
    return this.stationService.findAllChargePoints();
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
}
