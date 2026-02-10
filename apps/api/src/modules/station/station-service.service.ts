import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { CreateStationDto, UpdateStationDto, CreateChargePointDto, UpdateChargePointDto } from './dto/station.dto';
import { ChargerProvisioningService } from './provisioning/charger-provisioning.service';

type StationBounds = {
  north: number;
  south: number;
  east: number;
  west: number;
};

@Injectable()
export class StationService {
  private readonly logger = new Logger(StationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly provisioningService: ChargerProvisioningService,
  ) { }

  async handleOcppMessage(message: any) {
    const { chargePointId, action, payload } = message;
    this.logger.log(`Processing OCPP Action: ${action}`);

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
        siteId: site.id,
        orgId: createDto.orgId,
        ownerId: createDto.ownerId,
        // New Fields
        rating: createDto.rating || 0,
        price: createDto.price || 0,
        amenities: createDto.amenities || '[]',
        images: createDto.images || '[]',
        open247: createDto.open247 || false,
        phone: createDto.phone,
        bookingFee: createDto.bookingFee || 0
      } as any,
      include: { chargePoints: true, site: true }
    });
  }

  // Helper to walk up the zone hierarchy and find the continent or top-level region
  private deriveRegion(station: any): string {
    if (station.zone) {
      let current = station.zone;
      // Traverse up to 3 levels to find a Continent or root
      for (let i = 0; i < 5; i++) {
        if (current.type === 'CONTINENT' || ['AFRICA', 'EUROPE', 'AMERICAS', 'ASIA', 'MIDDLE_EAST'].includes(current.code)) {
          return current.name; // Return "Africa", "Europe", etc.
        }
        if (!current.parent) break;
        current = current.parent;
      }
      // If no continent found, return the top-most parent name found
      return current.name;
    }
    // Fallback to legacy fields
    return station.owner?.region || 'Unknown';
  }

  async findAllStations(bounds?: StationBounds) {
    const stations = await this.prisma.station.findMany({
      where: bounds
        ? {
          latitude: { gte: bounds.south, lte: bounds.north },
          longitude: { gte: bounds.west, lte: bounds.east }
        }
        : undefined,
      include: {
        chargePoints: true,
        site: true,
        zone: { include: { parent: { include: { parent: true } } } },
        owner: { include: { zone: true } }
      }
    });

    return stations.map((s: any) => this.mapToFrontendStation(s));
  }

  async findStationById(id: string) {
    const station = await this.prisma.station.findUnique({
      where: { id },
      include: {
        chargePoints: true,
        site: true,
        zone: { include: { parent: { include: { parent: true } } } },
        owner: { include: { zone: true } }
      }
    });
    if (!station) throw new NotFoundException('Station not found');

    return this.mapToFrontendStation(station);
  }

  async findStationByCode(code: string) {
    const station = await this.prisma.station.findFirst({
      where: { name: code },
      include: {
        chargePoints: true,
        site: true,
        zone: { include: { parent: { include: { parent: true } } } },
        owner: { include: { zone: true } }
      }
    });
    if (!station) throw new NotFoundException('Station not found');

    return this.mapToFrontendStation(station);
  }

  async updateStation(id: string, updateDto: UpdateStationDto) {
    await this.findStationById(id); // Ensure exists

    if (updateDto.siteId) {
      const site = await this.prisma.site.findUnique({ where: { id: updateDto.siteId } });
      if (!site) throw new NotFoundException('Site not found');
    }

    const updated = await this.prisma.station.update({
      where: { id },
      data: updateDto,
      include: { chargePoints: true, site: true }
    });
    // For update, we might want to return the raw entity or the mapped one. 
    // Usually admin panels expect raw, but let's keep it consistent if it's used by frontend.
    // For now, let's just return the raw updated entity as it was before, unless we know it breaks something.
    return updated;
  }

  async removeStation(id: string) {
    return this.prisma.station.delete({ where: { id } });
  }

  async getNearbyStations(lat: number, lng: number, radiusKm: number) {
    // Geo queries in Prisma are tricky without PostGIS raw queries
    // Returning top 10 for now
    const stations = await this.prisma.station.findMany({ take: 10, include: { chargePoints: true, site: true } });
    return stations.map((s: any) => this.mapToFrontendStation(s));
  }

  // --- Helper ---
  private mapToFrontendStation(s: any) {
    // Calculate availability
    const total = s.chargePoints ? s.chargePoints.length : 0;
    const available = s.chargePoints ? s.chargePoints.filter((cp: any) => cp.status === 'AVAILABLE').length : 0;
    const busy = s.chargePoints ? s.chargePoints.filter((cp: any) => cp.status === 'CHARGING' || cp.status === 'OCCUPIED').length : 0;
    const offline = s.chargePoints ? s.chargePoints.filter((cp: any) => cp.status === 'OFFLINE' || cp.status === 'FAULTED').length : 0;

    let amenities: string[] = [];
    let images: string[] = [];
    try {
      amenities = JSON.parse(s.amenities || '[]');
    } catch { amenities = []; }
    try {
      images = JSON.parse(s.images || '[]');
    } catch { images = []; }

    return {
      ...s,
      location: {
        lat: s.latitude,
        lng: s.longitude
      },
      availability: {
        total,
        available,
        busy,
        offline
      },
      connectors: s.chargePoints ? s.chargePoints.map((cp: any) => ({
        id: cp.id,
        type: cp.type || 'CCS2',
        power: cp.power || 50,
        status: cp.status.toLowerCase(),
        price: s.price || 0
      })) : [],
      rating: s.rating || 0,
      price: s.price || 0,
      amenities,
      images,
      open247: s.open247,
      phone: s.phone,
      bookingFee: s.bookingFee || 0,
      ownerId: s.ownerId || s.site?.ownerId,
      orgId: s.orgId || s.site?.organizationId,
      region: this.deriveRegion(s)
    };
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
    const cp = await this.prisma.chargePoint.create({
      data: {
        ocppId: createDto.ocppId,
        stationId: createDto.stationId,
        status: 'AVAILABLE',
        type: createDto.type || 'CCS2',
        power: createDto.power || 50.0
      },
      include: { station: { include: { site: true } } }
    });

    await this.provisioningService.provision(cp, cp.station);
    return cp;
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
    this.logger.log(`Rebooting charge point ${id}`);
    return { status: 'Reboot command sent' };
  }

  // --- OCPP Private Handlers ---
  private async handleBootNotification(ocppId: string, payload: any) {
    let cp = await this.prisma.chargePoint.findUnique({ where: { ocppId } });

    if (!cp) {
      this.logger.log('New ChargePoint detected');
      let defaultStation = await this.prisma.station.findFirst({ where: { name: 'Unknown' } });
      if (!defaultStation) {
        defaultStation = await this.prisma.station.create({
          data: { name: 'Unknown', address: 'N/A', latitude: 0, longitude: 0 }
        });
      }

      const createdCp = await this.prisma.chargePoint.create({
        data: {
          ocppId,
          stationId: defaultStation.id,
          status: 'Online',
          model: payload.chargePointModel,
          vendor: payload.chargePointVendor,
          firmwareVersion: payload.firmwareVersion
        },
        include: { station: { include: { site: true } } }
      });

      await this.provisioningService.provision(createdCp, createdCp.station);
    } else {
      const updatedCp = await this.prisma.chargePoint.update({
        where: { id: cp.id },
        data: {
          status: 'Online',
          firmwareVersion: payload.firmwareVersion || cp.firmwareVersion
          // Last heartbeat not in schema currently
        },
        include: { station: { include: { site: true } } }
      });

      await this.provisioningService.provision(updatedCp, updatedCp.station);
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

  async getStatusHistory(stationId: string) {
    return [];
  }
}
