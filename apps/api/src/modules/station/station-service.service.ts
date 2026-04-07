import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { isIP } from 'net';
import { PrismaService } from '../../prisma.service';
import {
  CreateStationDto,
  UpdateStationDto,
  CreateChargePointDto,
  UpdateChargePointDto,
  ConfirmChargePointIdentityDto,
  BindChargePointCertificateDto,
  UpdateChargePointBootstrapDto,
  RemoteStartChargePointCommandDto,
  UnlockChargePointCommandDto,
  UpdateFirmwareChargePointCommandDto,
  FirmwareEventHistoryQueryDto,
} from './dto/station.dto';
import { ChargerProvisioningService } from './provisioning/charger-provisioning.service';
import { parsePaginationOptions } from '../../common/utils/pagination';
import { CommandsService } from '../commands/commands.service';
import { OcpiService } from '../ocpi/ocpi.service';

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

type StationOperationalStatus =
  | 'ONLINE'
  | 'DEGRADED'
  | 'OFFLINE'
  | 'MAINTENANCE';

@Injectable()
export class StationService {
  private readonly logger = new Logger(StationService.name);
  private readonly enableNoAuthBootstrap: boolean;
  private readonly bootstrapDefaultMinutes: number;
  private readonly bootstrapMaxMinutes: number;
  private readonly publicWsBaseUrl: string;
  private readonly firmwareCommandsEnabled: boolean;
  private readonly firmwareStatusPersistenceEnabled: boolean;

  constructor(
    private readonly prisma: PrismaService,
    private readonly provisioningService: ChargerProvisioningService,
    private readonly commands: CommandsService,
    private readonly ocpiService: OcpiService,
  ) {
    this.enableNoAuthBootstrap =
      process.env.OCPP_ENABLE_NOAUTH_BOOTSTRAP === 'true';
    this.bootstrapDefaultMinutes = this.readIntEnv(
      'OCPP_NOAUTH_BOOTSTRAP_DEFAULT_MINUTES',
      30,
    );
    this.bootstrapMaxMinutes = this.readIntEnv(
      'OCPP_NOAUTH_BOOTSTRAP_MAX_MINUTES',
      120,
    );
    this.publicWsBaseUrl = this.resolvePublicWsBaseUrl(
      process.env.OCPP_PUBLIC_WS_BASE_URL || 'wss://ocpp.evzonecharging.com',
    );
    this.firmwareCommandsEnabled =
      process.env.FEATURE_OCPP_FIRMWARE_COMMANDS_ENABLED === 'true';
    this.firmwareStatusPersistenceEnabled =
      process.env.FEATURE_OCPP_FIRMWARE_STATUS_PERSIST_ENABLED === 'true';
  }

  async handleOcppMessage(message: any) {
    const normalized = this.normalizeStationEvent(message);
    if (!normalized.chargePointId) return;

    const action = normalized.action;
    const eventType = normalized.eventType;
    const eventPayload = normalized.payload;

    if (action) {
      this.logger.log(`Processing OCPP Action: ${action}`);
    } else if (eventType) {
      this.logger.log(`Processing station event: ${eventType}`);
    }

    if (action === 'BootNotification' || eventType === 'BootNotification') {
      await this.handleBootNotification(
        normalized.chargePointId,
        eventPayload,
        normalized.ocppVersion,
      );
      return;
    }

    if (
      action === 'Heartbeat' ||
      eventType === 'StationHeartbeat' ||
      eventType === 'Heartbeat'
    ) {
      await this.handleHeartbeat(
        normalized.chargePointId,
        normalized.ocppVersion,
      );
      return;
    }

    if (
      action === 'StatusNotification' ||
      eventType === 'ConnectorStatusChanged'
    ) {
      await this.handleConnectorStatusChanged(
        normalized.chargePointId,
        eventPayload,
        normalized.ocppVersion,
      );
      return;
    }

    if (
      action === 'FirmwareStatusNotification' ||
      eventType === 'FirmwareStatusNotification'
    ) {
      await this.handleFirmwareStatusNotification(
        normalized.chargePointId,
        normalized.payload,
        normalized.ocppVersion,
        normalized.gatewayEventId,
        normalized.occurredAt,
      );
      return;
    }

    if (eventType === 'StationDisconnected') {
      await this.handleChargePointDisconnected(
        normalized.chargePointId,
        normalized.ocppVersion,
      );
    }
  }

  // --- Station CRUD ---
  async createStation(createDto: CreateStationDto) {
    if (!createDto.siteId) {
      throw new BadRequestException('siteId is required to create a station');
    }
    const site = await this.prisma.site.findUnique({
      where: { id: createDto.siteId },
    });
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
        bookingFee: createDto.bookingFee || 0,
      } as any,
      include: { chargePoints: true, site: true },
    });
  }

  // Helper to walk up the zone hierarchy and find the continent or top-level region
  private deriveRegion(station: any): string {
    if (station.zone) {
      let current = station.zone;
      // Traverse up to 3 levels to find a Continent or root
      for (let i = 0; i < 5; i++) {
        if (
          current.type === 'CONTINENT' ||
          ['AFRICA', 'EUROPE', 'AMERICAS', 'ASIA', 'MIDDLE_EAST'].includes(
            current.code,
          )
        ) {
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

  async findAllStations(
    bounds?: StationBounds,
    q?: string,
    paginationInput?: { limit?: string; offset?: string },
  ) {
    const pagination = parsePaginationOptions(
      {
        limit: paginationInput?.limit,
        offset: paginationInput?.offset,
      },
      { limit: 50, maxLimit: 200 },
    );

    const where: any = {};

    if (bounds) {
      where.latitude = { gte: bounds.south, lte: bounds.north };
      where.longitude = { gte: bounds.west, lte: bounds.east };
    }

    const trimmedQuery = q?.trim();
    if (trimmedQuery) {
      where.OR = [
        { name: { contains: trimmedQuery, mode: 'insensitive' } },
        { address: { contains: trimmedQuery, mode: 'insensitive' } },
      ];
    }

    const stations = await this.prisma.station.findMany({
      where: Object.keys(where).length > 0 ? where : undefined,
      take: pagination.limit,
      skip: pagination.offset,
      include: {
        chargePoints: true,
        site: true,
        zone: { include: { parent: { include: { parent: true } } } },
        owner: { include: { zone: true } },
      },
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
        owner: { include: { zone: true } },
      },
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
        owner: { include: { zone: true } },
      },
    });
    if (!station) throw new NotFoundException('Station not found');

    return this.mapToFrontendStation(station);
  }

  async updateStation(id: string, updateDto: UpdateStationDto) {
    await this.findStationById(id); // Ensure exists

    if (updateDto.siteId) {
      const site = await this.prisma.site.findUnique({
        where: { id: updateDto.siteId },
      });
      if (!site) throw new NotFoundException('Site not found');
    }

    const updated = await this.prisma.station.update({
      where: { id },
      data: updateDto,
      include: { chargePoints: true, site: true },
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
    const stations = await this.prisma.station.findMany({
      take: 10,
      include: { chargePoints: true, site: true },
    });
    return stations.map((s: any) => this.mapToFrontendStation(s));
  }

  // --- Helper ---
  private mapToFrontendStation(s: any) {
    const chargePoints = Array.isArray(s.chargePoints) ? s.chargePoints : [];
    const total = chargePoints.length;
    const available = chargePoints.filter(
      (cp: any) => this.statusBucket(cp.status) === 'available',
    ).length;
    const busy = chargePoints.filter(
      (cp: any) => this.statusBucket(cp.status) === 'busy',
    ).length;
    const offline = chargePoints.filter(
      (cp: any) => this.statusBucket(cp.status) === 'offline',
    ).length;
    const operationalStatus = this.deriveOperationalStationStatus(
      s.status,
      s.type,
      chargePoints,
    );

    let amenities: string[] = [];
    let images: string[] = [];
    try {
      amenities = JSON.parse(s.amenities || '[]');
    } catch {
      amenities = [];
    }
    try {
      images = JSON.parse(s.images || '[]');
    } catch {
      images = [];
    }

    return {
      ...s,
      location: {
        lat: s.latitude,
        lng: s.longitude,
      },
      availability: {
        total,
        available,
        busy,
        offline,
      },
      operationalStatus,
      connectors: chargePoints.map((cp: any) => ({
        id: cp.id,
        type: cp.type || 'CCS2',
        power: cp.power || 50,
        status: this.normalizeChargePointStatus(cp.status),
        price: s.price || 0,
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
      region: this.deriveRegion(s),
    };
  }

  async getStationStats(id: string) {
    await this.findStationById(id);

    const aggregate = await this.prisma.session.aggregate({
      where: { stationId: id },
      _count: { _all: true },
      _sum: {
        totalEnergy: true,
        amount: true,
      },
      _avg: {
        totalEnergy: true,
      },
    });

    const completedSessions = await this.prisma.session.findMany({
      where: {
        stationId: id,
        endTime: { not: null },
      },
      select: {
        startTime: true,
        endTime: true,
      },
    });

    const averageSessionDuration =
      completedSessions.length > 0
        ? completedSessions.reduce((sum, session) => {
            return (
              sum +
              (session.endTime!.getTime() - session.startTime.getTime()) / 60000
            );
          }, 0) / completedSessions.length
        : 0;

    return {
      totalRevenue: Number((aggregate._sum.amount || 0).toFixed(2)),
      totalSessions: aggregate._count._all || 0,
      totalEnergy: Number((aggregate._sum.totalEnergy || 0).toFixed(2)),
      averageSessionDuration: Number(averageSessionDuration.toFixed(1)),
    };
  }

  async getSwapsToday(id: string) {
    return { successful: 10, failed: 0 };
  }

  // --- ChargePoint CRUD ---
  async findAllChargePoints(
    filter?: ChargePointListFilter,
    paginationInput?: { limit?: string; offset?: string },
  ) {
    const pagination = parsePaginationOptions(
      {
        limit: paginationInput?.limit,
        offset: paginationInput?.offset,
      },
      { limit: 50, maxLimit: 200 },
    );

    const where: any = {};
    if (filter?.stationId) {
      where.stationId = filter.stationId;
    }
    if (filter?.status) {
      where.status = { in: this.statusFilterValues(filter.status) };
    }

    const chargePoints = await this.prisma.chargePoint.findMany({
      where: Object.keys(where).length > 0 ? where : undefined,
      take: pagination.limit,
      skip: pagination.offset,
      include: {
        station: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    return this.attachRoamingPublicationList(chargePoints);
  }

  async findChargePointById(id: string) {
    const chargePoint = await this.prisma.chargePoint.findUnique({
      where: { id },
      include: { station: true },
    });
    if (!chargePoint) return null;
    return this.attachRoamingPublication(chargePoint);
  }

  async findChargePointByOcppId(ocppId: string) {
    const chargePoint = await this.prisma.chargePoint.findUnique({
      where: { ocppId },
      include: { station: true },
    });
    if (!chargePoint) return null;
    return this.attachRoamingPublication(chargePoint);
  }

  async createChargePoint(createDto: CreateChargePointDto) {
    const authProfile = createDto.authProfile || 'basic';
    const allowedIps = this.normalizeList(createDto.allowedIps);
    const allowedCidrs = this.normalizeList(createDto.allowedCidrs);
    const bootstrapTtlMinutes = this.resolveBootstrapTtl(
      createDto.bootstrapTtlMinutes,
    );

    if (authProfile === 'mtls_bootstrap') {
      if (!this.enableNoAuthBootstrap) {
        throw new BadRequestException(
          'No-password bootstrap is currently disabled',
        );
      }
      if (allowedIps.length === 0 && allowedCidrs.length === 0) {
        throw new BadRequestException(
          'allowedIps or allowedCidrs is required when authProfile is mtls_bootstrap',
        );
      }
      allowedCidrs.forEach((cidr) => this.assertValidCidr(cidr));
    }

    const ocppVersion = this.normalizeOcppVersion(createDto.ocppVersion);
    const oneTimePassword = randomBytes(18).toString('base64url');
    const secretSalt = randomBytes(16).toString('hex');
    const secretHash = createHash('sha256')
      .update(secretSalt)
      .update(oneTimePassword)
      .digest('hex');

    const cp = await this.prisma.chargePoint.create({
      data: {
        ocppId: createDto.ocppId,
        stationId: createDto.stationId,
        status: 'Offline',
        ocppVersion,
        model: createDto.model,
        vendor: createDto.manufacturer,
        firmwareVersion: createDto.firmwareVersion,
        clientSecretHash: secretHash,
        clientSecretSalt: secretSalt,
        allowedInsecure: authProfile === 'mtls_bootstrap',
        type: createDto.type || 'CCS2',
        power: createDto.power || 50.0,
      },
      include: { station: { include: { site: true } } },
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

    const withPublication = await this.attachRoamingPublication(cp);

    return {
      ...withPublication,
      ocppCredentials: {
        username: cp.ocppId,
        password: oneTimePassword,
        wsUrl: `${this.publicWsBaseUrl}/ocpp/${ocppVersion}/${cp.ocppId}`,
        subprotocol: this.subprotocolForVersion(ocppVersion),
        authProfile:
          authProfile === 'mtls_bootstrap' ? 'mtls_bootstrap' : 'basic',
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

  async bindChargePointCertificate(
    id: string,
    dto: BindChargePointCertificateDto,
  ) {
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
      data: { allowedInsecure: false },
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

  async updateChargePointBootstrap(
    id: string,
    dto: UpdateChargePointBootstrapDto,
  ) {
    const cp = await this.prisma.chargePoint.findUnique({ where: { id } });
    if (!cp) throw new NotFoundException('Charge Point not found');
    if (dto.enabled && !this.enableNoAuthBootstrap) {
      throw new BadRequestException(
        'No-password bootstrap is currently disabled',
      );
    }

    const allowedIps =
      dto.allowedIps !== undefined
        ? this.normalizeList(dto.allowedIps)
        : undefined;
    const allowedCidrs =
      dto.allowedCidrs !== undefined
        ? this.normalizeList(dto.allowedCidrs)
        : undefined;
    allowedCidrs?.forEach((cidr) => this.assertValidCidr(cidr));
    const ttlMinutes =
      dto.ttlMinutes !== undefined
        ? this.resolveBootstrapTtl(dto.ttlMinutes)
        : undefined;

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
      data: { allowedInsecure: dto.enabled },
    });

    return this.getChargePointSecurity(cp.id);
  }

  async updateChargePoint(id: string, updateDto: UpdateChargePointDto) {
    const existing = await this.getExistingChargePoint(id);
    const published = await this.isChargePointPublished(id);
    if (published) {
      const attemptedIdentityUpdate = Boolean(
        updateDto.model !== undefined ||
        updateDto.manufacturer !== undefined ||
        updateDto.firmwareVersion !== undefined,
      );
      if (attemptedIdentityUpdate) {
        throw new BadRequestException(
          'Identity fields are locked after publication.',
        );
      }
    }

    const updated = await this.prisma.chargePoint.update({
      where: { id: existing.id },
      data: {
        ...(updateDto.model !== undefined ? { model: updateDto.model } : {}),
        ...(updateDto.manufacturer !== undefined
          ? { vendor: updateDto.manufacturer }
          : {}),
        ...(updateDto.firmwareVersion !== undefined
          ? { firmwareVersion: updateDto.firmwareVersion }
          : {}),
        ...(updateDto.type !== undefined ? { type: updateDto.type } : {}),
        ...(updateDto.power !== undefined ? { power: updateDto.power } : {}),
      },
    });

    return this.attachRoamingPublication(updated);
  }

  async confirmChargePointIdentity(
    id: string,
    dto: ConfirmChargePointIdentityDto,
  ) {
    const existing = await this.getExistingChargePoint(id);
    if (await this.isChargePointPublished(id)) {
      throw new BadRequestException(
        'Identity fields are locked after publication.',
      );
    }

    const model = dto.model?.trim();
    const manufacturer = dto.manufacturer?.trim();
    const firmwareVersion = dto.firmwareVersion?.trim();

    if (!model || !manufacturer || !firmwareVersion) {
      throw new BadRequestException(
        'model, manufacturer, and firmwareVersion are required.',
      );
    }

    const updated = await this.prisma.chargePoint.update({
      where: { id: existing.id },
      data: {
        model,
        vendor: manufacturer,
        firmwareVersion,
        identityConfirmedAt: new Date(),
      },
      include: { station: true },
    });

    return this.attachRoamingPublication(updated);
  }

  async getChargePointPublication(id: string) {
    await this.getExistingChargePoint(id);
    const publication =
      await this.ocpiService.getChargePointRoamingPublication(id);
    return {
      chargePointId: publication.chargePointId,
      published: publication.published,
      updatedAt:
        (publication as any).updatedAt ??
        (publication as any).lastUpdatedAt ??
        null,
    };
  }

  async setChargePointPublication(id: string, published: boolean) {
    const chargePoint = await this.getExistingChargePoint(id);
    if (published) {
      this.assertPublishPreconditions(chargePoint);
    }
    return this.ocpiService.setChargePointRoamingPublication(id, published);
  }

  async removeChargePoint(id: string) {
    return this.prisma.chargePoint.delete({ where: { id } });
  }

  async rebootChargePoint(id: string) {
    return this.enqueueResetChargePointCommand(
      id,
      'Hard',
      'Reboot command queued',
    );
  }

  async softResetChargePoint(id: string) {
    return this.enqueueResetChargePointCommand(
      id,
      'Soft',
      'Soft reset command queued',
    );
  }

  async remoteStartChargePoint(
    id: string,
    dto: RemoteStartChargePointCommandDto = {},
  ) {
    const cp = await this.getExistingChargePoint(id);
    const connectorId = this.normalizePositiveInt(dto.connectorId) ?? 1;
    const evseId = this.normalizePositiveInt(dto.evseId) ?? connectorId;
    const idTag = (dto.idTag || 'EVZONE_REMOTE').trim();
    if (!idTag) {
      throw new BadRequestException('idTag must not be empty');
    }
    const remoteStartId =
      this.normalizePositiveInt(dto.remoteStartId) ||
      this.generateRemoteStartId();

    const response = await this.commands.enqueueCommand({
      commandType: 'RemoteStart',
      stationId: cp.stationId,
      chargePointId: cp.id,
      connectorId,
      payload: {
        idTag,
        connectorId,
        evseId,
        remoteStartId,
      },
      requestedBy: {},
    });

    this.logger.log(`Queued RemoteStart command for charge point ${id}`);
    return {
      ...response,
      stationId: cp.stationId,
      chargePointId: cp.id,
      commandType: 'RemoteStart',
      message: 'Remote start command queued',
    };
  }

  async unlockConnector(id: string, dto: UnlockChargePointCommandDto = {}) {
    const cp = await this.getExistingChargePoint(id);
    const connectorId = this.normalizePositiveInt(dto.connectorId) ?? 1;
    const evseId = this.normalizePositiveInt(dto.evseId) ?? connectorId;

    const response = await this.commands.enqueueCommand({
      commandType: 'UnlockConnector',
      stationId: cp.stationId,
      chargePointId: cp.id,
      connectorId,
      payload: {
        connectorId,
        evseId,
      },
      requestedBy: {},
    });

    this.logger.log(`Queued UnlockConnector command for charge point ${id}`);
    return {
      ...response,
      stationId: cp.stationId,
      chargePointId: cp.id,
      commandType: 'UnlockConnector',
      message: 'Unlock connector command queued',
    };
  }

  async updateFirmware(id: string, dto: UpdateFirmwareChargePointCommandDto) {
    if (!this.firmwareCommandsEnabled) {
      throw new BadRequestException(
        'Firmware update commands are disabled by FEATURE_OCPP_FIRMWARE_COMMANDS_ENABLED',
      );
    }

    const cp = await this.getExistingChargePoint(id);
    const retrieveAt = new Date(dto.retrieveAt);
    const installAt = dto.installAt ? new Date(dto.installAt) : null;

    if (Number.isNaN(retrieveAt.getTime())) {
      throw new BadRequestException('retrieveAt must be a valid ISO datetime');
    }
    if (installAt && Number.isNaN(installAt.getTime())) {
      throw new BadRequestException('installAt must be a valid ISO datetime');
    }
    if (installAt && installAt.getTime() < retrieveAt.getTime()) {
      throw new BadRequestException(
        'installAt must be greater than retrieveAt',
      );
    }

    const response = await this.commands.enqueueCommand({
      commandType: 'UpdateFirmware',
      stationId: cp.stationId,
      chargePointId: cp.id,
      payload: {
        location: dto.location.trim(),
        retrieveAt: retrieveAt.toISOString(),
        ...(installAt ? { installAt: installAt.toISOString() } : {}),
        ...(dto.retries !== undefined ? { retries: dto.retries } : {}),
        ...(dto.retryIntervalSec !== undefined
          ? { retryIntervalSec: dto.retryIntervalSec }
          : {}),
        ...(dto.requestId !== undefined ? { requestId: dto.requestId } : {}),
        ...(dto.signingCertificate
          ? { signingCertificate: dto.signingCertificate }
          : {}),
        ...(dto.signature ? { signature: dto.signature } : {}),
      },
      requestedBy: {},
    });

    this.logger.log(`Queued UpdateFirmware command for charge point ${id}`);
    return {
      ...response,
      stationId: cp.stationId,
      chargePointId: cp.id,
      commandType: 'UpdateFirmware',
      message: 'Firmware update command queued',
    };
  }

  async getFirmwareEvents(
    id: string,
    query: FirmwareEventHistoryQueryDto = {},
  ) {
    const cp = await this.getExistingChargePoint(id);
    const limit = Math.min(Math.max(query.limit || 50, 1), 200);
    const from = query.from ? new Date(query.from) : undefined;
    const to = query.to ? new Date(query.to) : undefined;
    const occurredAtFilter =
      from || to
        ? {
            ...(from ? { gte: from } : {}),
            ...(to ? { lte: to } : {}),
          }
        : undefined;

    const rows = await this.prisma.firmwareUpdateEvent.findMany({
      where: {
        chargePointId: cp.id,
        ...(occurredAtFilter ? { occurredAt: occurredAtFilter } : {}),
      },
      orderBy: { occurredAt: 'desc' },
      take: limit,
    });

    return rows.map((row) => ({
      ...row,
      occurredAt: row.occurredAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
    }));
  }

  // --- OCPP Private Handlers ---
  private async handleBootNotification(
    ocppId: string,
    payload: any,
    ocppVersion?: string,
  ) {
    const normalizedVersion = this.normalizeOcppVersion(ocppVersion);
    const bootNotificationAt = new Date();
    const model =
      payload?.chargingStation?.model || payload?.chargePointModel || undefined;
    const vendor =
      payload?.chargingStation?.vendorName ||
      payload?.chargePointVendor ||
      undefined;
    const firmwareVersion =
      payload?.chargingStation?.firmwareVersion ||
      payload?.firmwareVersion ||
      undefined;
    const cp = await this.prisma.chargePoint.findUnique({ where: { ocppId } });

    if (!cp) {
      this.logger.log('New ChargePoint detected');
      let defaultStation = await this.prisma.station.findFirst({
        where: { name: 'Unknown' },
      });
      if (!defaultStation) {
        defaultStation = await this.prisma.station.create({
          data: { name: 'Unknown', address: 'N/A', latitude: 0, longitude: 0 },
        });
      }

      const createdCp = await this.prisma.chargePoint.create({
        data: {
          ocppId,
          stationId: defaultStation.id,
          status: 'Online',
          ocppVersion: normalizedVersion,
          model,
          vendor,
          firmwareVersion,
          bootNotificationAt,
          bootNotificationPayload: payload || {},
          lastHeartbeat: new Date(),
        },
        include: { station: { include: { site: true } } },
      });

      await this.provisioningService.provision(createdCp, createdCp.station);
    } else {
      const shouldApplyBootIdentity = !cp.identityConfirmedAt;
      const updatedCp = await this.prisma.chargePoint.update({
        where: { id: cp.id },
        data: {
          status: 'Online',
          ocppVersion: normalizedVersion,
          ...(shouldApplyBootIdentity
            ? {
                model: model || cp.model,
                vendor: vendor || cp.vendor,
                firmwareVersion: firmwareVersion || cp.firmwareVersion,
              }
            : {}),
          bootNotificationAt,
          bootNotificationPayload: payload || {},
          lastHeartbeat: new Date(),
        },
        include: { station: { include: { site: true } } },
      });

      await this.provisioningService.provision(updatedCp, updatedCp.station);
    }
  }

  private async handleHeartbeat(ocppId: string, ocppVersion?: string) {
    const cp = await this.prisma.chargePoint.findUnique({ where: { ocppId } });
    if (cp) {
      await this.prisma.chargePoint.update({
        where: { id: cp.id },
        data: {
          status: 'Online',
          lastHeartbeat: new Date(),
          ocppVersion: this.normalizeOcppVersion(ocppVersion || cp.ocppVersion),
        },
      });
    }
  }

  private async handleConnectorStatusChanged(
    ocppId: string,
    payload: any,
    ocppVersion?: string,
  ) {
    const cp = await this.prisma.chargePoint.findUnique({ where: { ocppId } });
    if (!cp) return;

    const connectorStatus =
      typeof payload?.status === 'string'
        ? payload.status
        : typeof payload?.connectorStatus === 'string'
          ? payload.connectorStatus
          : undefined;

    await this.prisma.chargePoint.update({
      where: { id: cp.id },
      data: {
        status: this.mapConnectorStatusToChargePointStatus(
          connectorStatus,
          payload?.errorCode,
        ),
        ocppVersion: this.normalizeOcppVersion(ocppVersion || cp.ocppVersion),
      },
    });
  }

  private async handleFirmwareStatusNotification(
    ocppId: string,
    payload: any,
    ocppVersion?: string,
    gatewayEventId?: string,
    occurredAtRaw?: string,
  ) {
    if (!this.firmwareStatusPersistenceEnabled) {
      return;
    }

    const cp = await this.prisma.chargePoint.findUnique({ where: { ocppId } });
    if (!cp) return;

    const status = this.readString(payload?.status);
    if (!status) return;
    const requestId = this.normalizeNonNegativeInt(payload?.requestId);
    const occurredAt = this.parseOptionalDate(occurredAtRaw) || new Date();
    const normalizedVersion = this.normalizeOcppVersion(
      ocppVersion || cp.ocppVersion,
    );
    const resolvedGatewayEventId =
      this.readString(gatewayEventId) ||
      this.deriveFirmwareGatewayEventId(
        ocppId,
        status,
        requestId,
        occurredAt.toISOString(),
      );

    await this.prisma.$transaction(async (tx) => {
      await tx.chargePoint.update({
        where: { id: cp.id },
        data: {
          firmwareUpdateStatus: status,
          firmwareUpdateRequestId: requestId ?? null,
          firmwareStatusUpdatedAt: occurredAt,
          ocppVersion: normalizedVersion,
        },
      });

      await tx.firmwareUpdateEvent.upsert({
        where: { gatewayEventId: resolvedGatewayEventId },
        update: {},
        create: {
          gatewayEventId: resolvedGatewayEventId,
          chargePointId: cp.id,
          stationId: cp.stationId,
          ocppVersion: normalizedVersion,
          requestId: requestId ?? null,
          status,
          payload: payload || {},
          occurredAt,
        },
      });
    });
  }

  private async handleChargePointDisconnected(
    ocppId: string,
    ocppVersion?: string,
  ) {
    const cp = await this.prisma.chargePoint.findUnique({ where: { ocppId } });
    if (!cp) return;

    await this.prisma.chargePoint.update({
      where: { id: cp.id },
      data: {
        status: 'Offline',
        ocppVersion: this.normalizeOcppVersion(ocppVersion || cp.ocppVersion),
      },
    });
  }

  async getStatusHistory(stationId: string) {
    return [];
  }

  private async enqueueResetChargePointCommand(
    id: string,
    type: 'Soft' | 'Hard',
    message: string,
  ) {
    const cp = await this.getExistingChargePoint(id);
    const response = await this.commands.enqueueCommand({
      commandType: 'Reset',
      stationId: cp.stationId,
      chargePointId: cp.id,
      payload: { type },
      requestedBy: {},
    });

    this.logger.log(`Queued ${type} Reset command for charge point ${id}`);
    return {
      ...response,
      stationId: cp.stationId,
      chargePointId: cp.id,
      commandType: 'Reset',
      message,
    };
  }

  private async getExistingChargePoint(id: string) {
    const chargePoint = await this.findChargePointById(id);
    if (!chargePoint) throw new NotFoundException('Charge Point not found');
    return chargePoint;
  }

  private async attachRoamingPublicationList<T extends { id: string }>(
    chargePoints: T[],
  ): Promise<Array<T & { roamingPublished: boolean }>> {
    if (chargePoints.length === 0) return [];

    const publishedRows = await this.prisma.ocpiPartnerLocation.findMany({
      where: {
        countryCode: this.defaultOcpiCountryCode(),
        partyId: this.defaultOcpiPartyId(),
        locationId: { in: chargePoints.map((chargePoint) => chargePoint.id) },
      },
      select: { locationId: true },
    });
    const publishedLocationIds = new Set(
      publishedRows.map((row) => row.locationId),
    );

    return chargePoints.map((chargePoint) => ({
      ...chargePoint,
      roamingPublished: publishedLocationIds.has(chargePoint.id),
    }));
  }

  private async attachRoamingPublication<T extends { id: string }>(
    chargePoint: T,
  ): Promise<T & { roamingPublished: boolean }> {
    const [mapped] = await this.attachRoamingPublicationList([chargePoint]);
    return mapped;
  }

  private async isChargePointPublished(
    chargePointId: string,
  ): Promise<boolean> {
    const publication =
      await this.ocpiService.getChargePointRoamingPublication(chargePointId);
    return publication.published;
  }

  private assertPublishPreconditions(chargePoint: {
    bootNotificationAt?: Date | null;
    identityConfirmedAt?: Date | null;
    model?: string | null;
    vendor?: string | null;
    firmwareVersion?: string | null;
  }) {
    if (!chargePoint.bootNotificationAt) {
      throw new BadRequestException(
        'BootNotification is required before publication.',
      );
    }
    if (!chargePoint.identityConfirmedAt) {
      throw new BadRequestException(
        'Identity must be confirmed before publication.',
      );
    }
    if (!this.hasCompleteIdentity(chargePoint)) {
      throw new BadRequestException(
        'Complete identity (model, manufacturer, firmwareVersion) is required before publication.',
      );
    }
  }

  private hasCompleteIdentity(chargePoint: {
    model?: string | null;
    vendor?: string | null;
    firmwareVersion?: string | null;
  }): boolean {
    return Boolean(
      chargePoint.model?.trim() &&
      chargePoint.vendor?.trim() &&
      chargePoint.firmwareVersion?.trim(),
    );
  }

  private defaultOcpiCountryCode(): string {
    return (process.env.OCPI_COUNTRY_CODE || 'US').trim().toUpperCase();
  }

  private defaultOcpiPartyId(): string {
    return (process.env.OCPI_PARTY_ID || 'EVZ').trim().toUpperCase();
  }

  private normalizePositiveInt(value: unknown): number | undefined {
    if (value === undefined || value === null || value === '') return undefined;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return undefined;
    const normalized = Math.floor(parsed);
    return normalized > 0 ? normalized : undefined;
  }

  private generateRemoteStartId(): number {
    return Math.floor(Date.now() / 1000);
  }

  private normalizeNonNegativeInt(value: unknown): number | undefined {
    if (value === undefined || value === null || value === '') return undefined;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return undefined;
    const normalized = Math.floor(parsed);
    return normalized >= 0 ? normalized : undefined;
  }

  private normalizeOcppVersion(version?: string): '1.6' | '2.0.1' | '2.1' {
    const normalized = String(version || '')
      .trim()
      .toLowerCase();
    if (normalized === '2.0.1') return '2.0.1';
    if (normalized === '2.1') return '2.1';
    if (normalized === '1.6' || normalized === '1.6j') return '1.6';
    return '1.6';
  }

  private normalizeStationEvent(message: any): {
    chargePointId?: string;
    action?: string;
    eventType?: string;
    ocppVersion?: string;
    payload?: any;
    gatewayEventId?: string;
    occurredAt?: string;
  } {
    const input = this.unwrapEnvelope(message);
    if (!input || typeof input !== 'object') {
      return {};
    }

    const chargePointId = this.readString(
      input.chargePointId || input.ocppId || input.chargePoint?.ocppId,
    );
    const eventType = this.readString(input.eventType);
    const rawPayload = input.payload ?? input.data;
    const payload =
      rawPayload &&
      typeof rawPayload === 'object' &&
      !Array.isArray(rawPayload) &&
      rawPayload.payload &&
      typeof rawPayload.payload === 'object'
        ? rawPayload.payload
        : rawPayload;
    const action =
      this.readString(input.action) || this.readString(rawPayload?.action);
    const ocppVersion =
      this.readString(input.ocppVersion) ||
      this.readString(rawPayload?.ocppVersion);
    const gatewayEventId =
      this.readString(input.eventId) ||
      this.readString(input.id) ||
      this.readString(rawPayload?.eventId);
    const occurredAt =
      this.readString(input.occurredAt) ||
      this.readString(rawPayload?.occurredAt);

    return {
      chargePointId,
      action,
      eventType,
      ocppVersion,
      payload,
      gatewayEventId,
      occurredAt,
    };
  }

  private unwrapEnvelope(message: any): any {
    if (typeof message === 'string') {
      try {
        return JSON.parse(message);
      } catch {
        return null;
      }
    }
    if (message && typeof message === 'object' && message.value !== undefined) {
      return this.unwrapEnvelope(message.value);
    }
    return message;
  }

  private readString(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  private parseOptionalDate(value: unknown): Date | undefined {
    if (typeof value !== 'string' || value.trim().length === 0) {
      return undefined;
    }
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return undefined;
    return parsed;
  }

  private deriveFirmwareGatewayEventId(
    ocppId: string,
    status: string,
    requestId: number | undefined,
    occurredAtIso: string,
  ): string {
    return createHash('sha256')
      .update(ocppId)
      .update('|')
      .update(status)
      .update('|')
      .update(requestId !== undefined ? String(requestId) : 'none')
      .update('|')
      .update(occurredAtIso)
      .digest('hex');
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
    return Array.from(
      new Set(values.map((value) => value.trim()).filter(Boolean)),
    );
  }

  private normalizeFingerprint(value: string): string {
    return value.replace(/:/g, '').trim().toUpperCase();
  }

  private assertValidFingerprint(value: string): void {
    if (!/^[A-F0-9]{64}$/.test(value)) {
      throw new BadRequestException('fingerprint must be a SHA-256 hex value');
    }
  }

  private assertOptionalIsoDate(
    value: string | undefined,
    field: string,
  ): void {
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

  private deriveOperationalStationStatus(
    stationStatus: string | undefined,
    stationType: string | undefined,
    chargePoints: Array<{ status?: string }>,
  ): StationOperationalStatus {
    const lifecycleStatus = (stationStatus || '').trim().toUpperCase();
    if (lifecycleStatus === 'MAINTENANCE') return 'MAINTENANCE';
    if (lifecycleStatus === 'INACTIVE') return 'OFFLINE';

    const normalizedType = (stationType || '').trim().toUpperCase();
    const isChargeCapable =
      normalizedType === 'CHARGING' || normalizedType === 'BOTH';

    if (!isChargeCapable) {
      if (lifecycleStatus === 'ACTIVE') return 'ONLINE';
      if (lifecycleStatus === 'INACTIVE') return 'OFFLINE';
      if (lifecycleStatus === 'MAINTENANCE') return 'MAINTENANCE';
      return 'DEGRADED';
    }

    if (!chargePoints.length) return 'DEGRADED';

    let offlineCount = 0;
    let operationalCount = 0;
    let unknownCount = 0;

    for (const chargePoint of chargePoints) {
      const normalizedStatus = this.normalizeChargePointStatus(
        chargePoint.status,
      );
      if (this.isOfflineChargePointStatus(normalizedStatus)) {
        offlineCount += 1;
        continue;
      }
      if (this.isOperationalChargePointStatus(normalizedStatus)) {
        operationalCount += 1;
        continue;
      }
      unknownCount += 1;
    }

    if (offlineCount === chargePoints.length) return 'OFFLINE';
    if (offlineCount > 0 && operationalCount > 0) return 'DEGRADED';
    if (offlineCount > 0 && operationalCount === 0) return 'DEGRADED';
    if (operationalCount > 0 && unknownCount === 0) return 'ONLINE';
    if (operationalCount > 0 && unknownCount > 0) return 'DEGRADED';
    return 'DEGRADED';
  }

  private isOfflineChargePointStatus(normalizedStatus: string): boolean {
    return (
      normalizedStatus === 'offline' ||
      normalizedStatus === 'faulted' ||
      normalizedStatus === 'unavailable' ||
      normalizedStatus === 'inoperative'
    );
  }

  private isOperationalChargePointStatus(normalizedStatus: string): boolean {
    return (
      normalizedStatus === 'online' ||
      normalizedStatus === 'available' ||
      normalizedStatus === 'charging' ||
      normalizedStatus === 'occupied' ||
      normalizedStatus === 'preparing' ||
      normalizedStatus === 'reserved' ||
      normalizedStatus === 'suspendedev' ||
      normalizedStatus === 'suspendedevse' ||
      normalizedStatus === 'finishing'
    );
  }

  private mapConnectorStatusToChargePointStatus(
    status?: string,
    errorCode?: string,
  ): string {
    const normalized = this.normalizeChargePointStatus(status);
    const normalizedError = this.normalizeChargePointStatus(errorCode);

    if (normalizedError && normalizedError !== 'noerror') {
      return 'Faulted';
    }

    if (
      normalized === 'charging' ||
      normalized === 'occupied' ||
      normalized === 'suspendedev' ||
      normalized === 'suspendedevse' ||
      normalized === 'preparing'
    ) {
      return 'Charging';
    }

    if (
      normalized === 'faulted' ||
      normalized === 'unavailable' ||
      normalized === 'inoperative' ||
      normalized === 'offline'
    ) {
      return 'Offline';
    }

    if (normalized === 'reserved') {
      return 'Reserved';
    }

    return 'Online';
  }

  private statusBucket(
    status: string | undefined,
  ): 'available' | 'busy' | 'offline' | 'other' {
    const normalized = this.normalizeChargePointStatus(status);
    if (normalized === 'available' || normalized === 'online')
      return 'available';
    if (normalized === 'charging' || normalized === 'occupied') return 'busy';
    if (
      normalized === 'offline' ||
      normalized === 'faulted' ||
      normalized === 'unavailable'
    ) {
      return 'offline';
    }
    return 'other';
  }

  private statusFilterValues(status: string): string[] {
    const normalized = this.normalizeChargePointStatus(status);
    const values = new Set<string>([status.trim()]);
    const add = (...entries: string[]) =>
      entries.forEach((entry) => values.add(entry));

    switch (normalized) {
      case 'online':
      case 'available':
        add(
          'online',
          'Online',
          'ONLINE',
          'available',
          'Available',
          'AVAILABLE',
        );
        break;
      case 'charging':
      case 'occupied':
      case 'busy':
        add(
          'charging',
          'Charging',
          'CHARGING',
          'occupied',
          'Occupied',
          'OCCUPIED',
        );
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
          'UNAVAILABLE',
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
        `Invalid OCPP_PUBLIC_WS_BASE_URL "${raw}", falling back to wss://ocpp.evzonecharging.com`,
      );
      return 'wss://ocpp.evzonecharging.com';
    }
    return trimmed;
  }
}
