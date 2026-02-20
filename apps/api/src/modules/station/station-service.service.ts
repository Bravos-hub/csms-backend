import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { isIP } from 'net';
import { PrismaService } from '../../prisma.service';
import {
  CreateStationDto,
  UpdateStationDto,
  CreateChargePointDto,
  UpdateChargePointDto,
  BindChargePointCertificateDto,
  UpdateChargePointBootstrapDto
} from './dto/station.dto';
import { ChargerProvisioningService } from './provisioning/charger-provisioning.service';

type StationBounds = {
  north: number;
  south: number;
  east: number;
  west: number;
};

type ChargePointListFilter = {
  stationId?: string;
  status?: string;
};

@Injectable()
export class StationService {
  private readonly logger = new Logger(StationService.name);
  private readonly enableNoAuthBootstrap: boolean;
  private readonly bootstrapDefaultMinutes: number;
  private readonly bootstrapMaxMinutes: number;
  private readonly publicWsBaseUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly provisioningService: ChargerProvisioningService,
  ) {
    this.enableNoAuthBootstrap = process.env.OCPP_ENABLE_NOAUTH_BOOTSTRAP === 'true';
    this.bootstrapDefaultMinutes = this.readIntEnv('OCPP_NOAUTH_BOOTSTRAP_DEFAULT_MINUTES', 30);
    this.bootstrapMaxMinutes = this.readIntEnv('OCPP_NOAUTH_BOOTSTRAP_MAX_MINUTES', 120);
    this.publicWsBaseUrl = this.resolvePublicWsBaseUrl(
      process.env.OCPP_PUBLIC_WS_BASE_URL || 'wss://ocpp.evzonecharging.com'
    );
  }

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

  async findAllStations(bounds?: StationBounds, q?: string) {
    const where: any = {};

    if (bounds) {
      where.latitude = { gte: bounds.south, lte: bounds.north };
      where.longitude = { gte: bounds.west, lte: bounds.east };
    }

    const trimmedQuery = q?.trim();
    if (trimmedQuery) {
      where.OR = [
        { name: { contains: trimmedQuery, mode: 'insensitive' } },
        { address: { contains: trimmedQuery, mode: 'insensitive' } }
      ];
    }

    const stations = await this.prisma.station.findMany({
      where: Object.keys(where).length > 0 ? where : undefined,
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
    const chargePoints = Array.isArray(s.chargePoints) ? s.chargePoints : [];
    const total = chargePoints.length;
    const available = chargePoints.filter((cp: any) => this.statusBucket(cp.status) === 'available').length;
    const busy = chargePoints.filter((cp: any) => this.statusBucket(cp.status) === 'busy').length;
    const offline = chargePoints.filter((cp: any) => this.statusBucket(cp.status) === 'offline').length;

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
      connectors: chargePoints.map((cp: any) => ({
        id: cp.id,
        type: cp.type || 'CCS2',
        power: cp.power || 50,
        status: this.normalizeChargePointStatus(cp.status),
        price: s.price || 0
      })),
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
  async findAllChargePoints(filter?: ChargePointListFilter) {
    const where: any = {};
    if (filter?.stationId) {
      where.stationId = filter.stationId;
    }
    if (filter?.status) {
      where.status = { in: this.statusFilterValues(filter.status) };
    }

    return this.prisma.chargePoint.findMany({
      where: Object.keys(where).length > 0 ? where : undefined,
    });
  }

  async findChargePointById(id: string) {
    return this.prisma.chargePoint.findUnique({ where: { id }, include: { station: true } });
  }

  async findChargePointByOcppId(ocppId: string) {
    return this.prisma.chargePoint.findUnique({ where: { ocppId }, include: { station: true } });
  }

  async createChargePoint(createDto: CreateChargePointDto) {
    const authProfile = createDto.authProfile || 'basic';
    const allowedIps = this.normalizeList(createDto.allowedIps);
    const allowedCidrs = this.normalizeList(createDto.allowedCidrs);
    const bootstrapTtlMinutes = this.resolveBootstrapTtl(createDto.bootstrapTtlMinutes);

    if (authProfile === 'mtls_bootstrap') {
      if (!this.enableNoAuthBootstrap) {
        throw new BadRequestException('No-password bootstrap is currently disabled');
      }
      if (allowedIps.length === 0 && allowedCidrs.length === 0) {
        throw new BadRequestException(
          'allowedIps or allowedCidrs is required when authProfile is mtls_bootstrap'
        );
      }
      allowedCidrs.forEach((cidr) => this.assertValidCidr(cidr));
    }

    const ocppVersion = this.normalizeOcppVersion(createDto.ocppVersion);
    const oneTimePassword = randomBytes(18).toString('base64url');
    const secretSalt = randomBytes(16).toString('hex');
    const secretHash = createHash('sha256').update(secretSalt).update(oneTimePassword).digest('hex');

    const cp = await this.prisma.chargePoint.create({
      data: {
        ocppId: createDto.ocppId,
        stationId: createDto.stationId,
        status: 'Offline',
        model: createDto.model,
        vendor: createDto.manufacturer,
        firmwareVersion: createDto.firmwareVersion,
        clientSecretHash: secretHash,
        clientSecretSalt: secretSalt,
        allowedInsecure: authProfile === 'mtls_bootstrap',
        type: createDto.type || 'CCS2',
        power: createDto.power || 50.0
      },
      include: { station: { include: { site: true } } }
    });

    await this.provisioningService.provision(cp, cp.station, ocppVersion, {
      authProfile,
      bootstrapTtlMinutes,
      allowedIps,
      allowedCidrs,
    });
    const bootstrapExpiresAt =
      authProfile === 'mtls_bootstrap'
        ? new Date(Date.now() + bootstrapTtlMinutes * 60_000).toISOString()
        : undefined;

    return {
      ...cp,
      ocppCredentials: {
        username: cp.ocppId,
        password: oneTimePassword,
        wsUrl: `${this.publicWsBaseUrl}/ocpp/${ocppVersion}/${cp.ocppId}`,
        subprotocol: this.subprotocolForVersion(ocppVersion),
        authProfile: authProfile === 'mtls_bootstrap' ? 'mtls_bootstrap' : 'basic',
        bootstrapExpiresAt,
        requiresClientCertificate: authProfile === 'mtls_bootstrap',
        mtlsInstructions:
          authProfile === 'mtls_bootstrap'
            ? 'Use the URL and subprotocol now. Connection is temporary, IP-restricted, and no-password. Complete mTLS certificate binding before bootstrap expires.'
            : undefined,
      },
    };
  }

  async getChargePointSecurity(id: string) {
    const cp = await this.prisma.chargePoint.findUnique({ where: { id } });
    if (!cp) throw new NotFoundException('Charge Point not found');
    const security = await this.provisioningService.getSecurityState(cp.ocppId);
    return {
      chargePointId: cp.id,
      ocppId: cp.ocppId,
      ...security,
    };
  }

  async bindChargePointCertificate(id: string, dto: BindChargePointCertificateDto) {
    const cp = await this.prisma.chargePoint.findUnique({ where: { id } });
    if (!cp) throw new NotFoundException('Charge Point not found');

    const normalizedFingerprint = this.normalizeFingerprint(dto.fingerprint);
    this.assertValidFingerprint(normalizedFingerprint);
    this.assertOptionalIsoDate(dto.validFrom, 'validFrom');
    this.assertOptionalIsoDate(dto.validTo, 'validTo');

    try {
      await this.provisioningService.bindCertificate(cp.ocppId, {
        fingerprint: normalizedFingerprint,
        subject: dto.subject,
        validFrom: dto.validFrom,
        validTo: dto.validTo,
      });
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    }
    await this.prisma.chargePoint.update({
      where: { id: cp.id },
      data: { allowedInsecure: false }
    });

    return {
      status: 'ok',
      chargePointId: cp.id,
      ocppId: cp.ocppId,
      fingerprint: normalizedFingerprint,
      authProfile: 'mtls',
      requiresClientCertificate: true,
    };
  }

  async updateChargePointBootstrap(id: string, dto: UpdateChargePointBootstrapDto) {
    const cp = await this.prisma.chargePoint.findUnique({ where: { id } });
    if (!cp) throw new NotFoundException('Charge Point not found');
    if (dto.enabled && !this.enableNoAuthBootstrap) {
      throw new BadRequestException('No-password bootstrap is currently disabled');
    }

    const allowedIps = dto.allowedIps !== undefined ? this.normalizeList(dto.allowedIps) : undefined;
    const allowedCidrs = dto.allowedCidrs !== undefined ? this.normalizeList(dto.allowedCidrs) : undefined;
    allowedCidrs?.forEach((cidr) => this.assertValidCidr(cidr));
    const ttlMinutes = dto.ttlMinutes !== undefined ? this.resolveBootstrapTtl(dto.ttlMinutes) : undefined;

    try {
      await this.provisioningService.updateBootstrap(cp.ocppId, {
        enabled: dto.enabled,
        ttlMinutes,
        allowedIps,
        allowedCidrs,
      });
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    }

    await this.prisma.chargePoint.update({
      where: { id: cp.id },
      data: { allowedInsecure: dto.enabled }
    });

    return this.getChargePointSecurity(cp.id);
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

  private normalizeOcppVersion(version?: string): '1.6' | '2.0.1' | '2.1' {
    if (version === '2.0.1' || version === '2.1') {
      return version;
    }
    return '1.6';
  }

  private subprotocolForVersion(version: '1.6' | '2.0.1' | '2.1'): string {
    if (version === '2.0.1') return 'ocpp2.0.1';
    if (version === '2.1') return 'ocpp2.1';
    return 'ocpp1.6';
  }

  private resolveBootstrapTtl(input?: number): number {
    const fallback = input ?? this.bootstrapDefaultMinutes;
    const bounded = Math.max(1, Math.floor(fallback));
    return Math.min(bounded, Math.max(1, this.bootstrapMaxMinutes));
  }

  private normalizeList(values?: string[]): string[] {
    if (!values || values.length === 0) return [];
    return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
  }

  private normalizeFingerprint(value: string): string {
    return value.replace(/:/g, '').trim().toUpperCase();
  }

  private assertValidFingerprint(value: string): void {
    if (!/^[A-F0-9]{64}$/.test(value)) {
      throw new BadRequestException('fingerprint must be a SHA-256 hex value');
    }
  }

  private assertOptionalIsoDate(value: string | undefined, field: string): void {
    if (!value) return;
    if (Number.isNaN(Date.parse(value))) {
      throw new BadRequestException(`${field} must be a valid ISO datetime`);
    }
  }

  private assertValidCidr(value: string): void {
    const [ipRaw, prefixRaw] = value.split('/');
    if (!ipRaw || prefixRaw === undefined) {
      throw new BadRequestException(`Invalid CIDR entry: ${value}`);
    }
    const version = isIP(ipRaw.trim());
    if (!version) {
      throw new BadRequestException(`Invalid CIDR IP: ${value}`);
    }
    const prefix = Number(prefixRaw);
    const maxPrefix = version === 4 ? 32 : 128;
    if (!Number.isInteger(prefix) || prefix < 0 || prefix > maxPrefix) {
      throw new BadRequestException(`Invalid CIDR prefix: ${value}`);
    }
  }

  private readIntEnv(key: string, fallback: number): number {
    const raw = process.env[key];
    if (!raw) return fallback;
    const parsed = parseInt(raw, 10);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  private normalizeChargePointStatus(value: string | undefined): string {
    return (value || 'Unknown').trim().toLowerCase();
  }

  private statusBucket(status: string | undefined): 'available' | 'busy' | 'offline' | 'other' {
    const normalized = this.normalizeChargePointStatus(status);
    if (normalized === 'available' || normalized === 'online') return 'available';
    if (normalized === 'charging' || normalized === 'occupied') return 'busy';
    if (normalized === 'offline' || normalized === 'faulted' || normalized === 'unavailable') {
      return 'offline';
    }
    return 'other';
  }

  private statusFilterValues(status: string): string[] {
    const normalized = this.normalizeChargePointStatus(status);
    const values = new Set<string>([status.trim()]);
    const add = (...entries: string[]) => entries.forEach((entry) => values.add(entry));

    switch (normalized) {
      case 'online':
      case 'available':
        add('online', 'Online', 'ONLINE', 'available', 'Available', 'AVAILABLE');
        break;
      case 'charging':
      case 'occupied':
      case 'busy':
        add('charging', 'Charging', 'CHARGING', 'occupied', 'Occupied', 'OCCUPIED');
        break;
      case 'offline':
      case 'faulted':
      case 'unavailable':
        add(
          'offline',
          'Offline',
          'OFFLINE',
          'faulted',
          'Faulted',
          'FAULTED',
          'unavailable',
          'Unavailable',
          'UNAVAILABLE'
        );
        break;
      default:
        add(normalized, normalized.toUpperCase());
        break;
    }

    return Array.from(values).filter(Boolean);
  }

  private resolvePublicWsBaseUrl(raw: string): string {
    const trimmed = raw.trim().replace(/\/+$/, '');
    if (!/^wss?:\/\//i.test(trimmed)) {
      this.logger.warn(
        `Invalid OCPP_PUBLIC_WS_BASE_URL "${raw}", falling back to wss://ocpp.evzonecharging.com`
      );
      return 'wss://ocpp.evzonecharging.com';
    }
    return trimmed;
  }
}
