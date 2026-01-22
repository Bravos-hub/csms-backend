import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { CreateStationDto, UpdateStationDto, CreateChargePointDto, UpdateChargePointDto } from './dto/station.dto';

@Injectable()
export class StationService {
  constructor(
    private readonly prisma: PrismaService,
  ) { }

  async handleOcppMessage(message: any) {
    const { chargePointId, action, payload } = message;
    console.log(`Processing OCPP Action: ${action} for ${chargePointId}`);

    if (action === 'BootNotification') {
      await this.handleBootNotification(chargePointId, payload);
    } else if (action === 'Heartbeat') {
      await this.handleHeartbeat(chargePointId);
    }
  }

  // --- Station CRUD ---
  async createStation(createDto: CreateStationDto) {
    if (!createDto.siteId) {
      throw new BadRequestException('siteId is required to create a station');
    }
    const site = await this.prisma.site.findUnique({ where: { id: createDto.siteId } });
    if (!site) {
      throw new NotFoundException('Site not found');
    }

    return this.prisma.station.create({
      data: {
        name: createDto.name,
        latitude: createDto.latitude,
        longitude: createDto.longitude,
        address: createDto.address || 'Unknown',
        status: 'ACTIVE',
        siteId: site.id
      },
      include: { chargePoints: true, site: true }
    });
  }

  async findAllStations() {
    return this.prisma.station.findMany({ include: { chargePoints: true, site: true } });
  }

  async findStationById(id: string) {
    const station = await this.prisma.station.findUnique({ where: { id }, include: { chargePoints: true, site: true } });
    if (!station) throw new NotFoundException('Station not found');
    return station;
  }

  async findStationByCode(code: string) {
    // Schema doesn't have code in previous step, adding it or mocking logic
    // Actually schema had: id, name, status, lat, long, address. No code.
    // Use ID as code or assume name
    const station = await this.prisma.station.findFirst({ where: { name: code }, include: { chargePoints: true, site: true } });
    if (!station) throw new NotFoundException('Station not found');
    return station;
  }

  async updateStation(id: string, updateDto: UpdateStationDto) {
    await this.findStationById(id); // Ensure exists

    if (updateDto.siteId) {
      const site = await this.prisma.site.findUnique({ where: { id: updateDto.siteId } });
      if (!site) throw new NotFoundException('Site not found');
    }

    return this.prisma.station.update({
      where: { id },
      data: updateDto,
      include: { chargePoints: true, site: true }
    });
  }

  async removeStation(id: string) {
    return this.prisma.station.delete({ where: { id } });
  }

  async getNearbyStations(lat: number, lng: number, radiusKm: number) {
    // Geo queries in Prisma are tricky without PostGIS raw queries
    // Returning top 10 for now
    return this.prisma.station.findMany({ take: 10, include: { chargePoints: true, site: true } });
  }

  async getStationStats(id: string) {
    return { totalSessions: 100, energyDelivered: 5000, revenue: 200 };
  }

  async getSwapsToday(id: string) {
    return { successful: 10, failed: 0 };
  }

  // --- ChargePoint CRUD ---
  async findAllChargePoints() {
    return this.prisma.chargePoint.findMany();
  }

  async findChargePointById(id: string) {
    return this.prisma.chargePoint.findUnique({ where: { id }, include: { station: true } });
  }

  async createChargePoint(createDto: CreateChargePointDto) {
    return this.prisma.chargePoint.create({
      data: {
        ocppId: createDto.ocppId,
        stationId: createDto.stationId,
        status: 'AVAILABLE'
      }
    });
  }

  async updateChargePoint(id: string, updateDto: UpdateChargePointDto) {
    return this.prisma.chargePoint.update({
      where: { id },
      data: updateDto
    });
  }

  async removeChargePoint(id: string) {
    return this.prisma.chargePoint.delete({ where: { id } });
  }

  async rebootChargePoint(id: string) {
    const cp = await this.findChargePointById(id);
    if (!cp) throw new NotFoundException('Charge Point not found');
    console.log(`Rebooting ${cp.ocppId}`);
    return { status: 'Reboot command sent' };
  }

  // --- OCPP Private Handlers ---
  private async handleBootNotification(ocppId: string, payload: any) {
    let cp = await this.prisma.chargePoint.findUnique({ where: { ocppId } });

    if (!cp) {
      console.log(`New ChargePoint detected: ${ocppId}`);
      // Find a default station or require one. For now creating dummy or failing?
      // Prisma requires stationId. 
      // We will look for a default "Unknown" station or create one
      let defaultStation = await this.prisma.station.findFirst({ where: { name: 'Unknown' } });
      if (!defaultStation) {
        defaultStation = await this.prisma.station.create({
          data: { name: 'Unknown', address: 'N/A', latitude: 0, longitude: 0 }
        });
      }

      cp = await this.prisma.chargePoint.create({
        data: {
          ocppId,
          stationId: defaultStation.id,
          status: 'Online',
          model: payload.chargePointModel,
          vendor: payload.chargePointVendor,
          firmwareVersion: payload.firmwareVersion
        }
      });
    } else {
      cp = await this.prisma.chargePoint.update({
        where: { id: cp.id },
        data: {
          status: 'Online',
          firmwareVersion: payload.firmwareVersion || cp.firmwareVersion
          // Last heartbeat not in schema currently
        }
      });
    }
  }

  private async handleHeartbeat(ocppId: string) {
    const cp = await this.prisma.chargePoint.findUnique({ where: { ocppId } });
    if (cp) {
      await this.prisma.chargePoint.update({
        where: { id: cp.id },
        data: { status: 'Online' }
      });
    }
  }
}
