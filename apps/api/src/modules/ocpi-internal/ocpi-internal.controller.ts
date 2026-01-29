import {
  Body,
  Controller,
  Get,
  NotImplementedException,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ServiceAuthGuard } from '../auth/service-auth.guard';
import { ServiceScopeGuard } from '../auth/service-scope.guard';
import { ServiceScopes } from '../auth/service-scopes.decorator';
import { CommandsService } from '../commands/commands.service';
import { PrismaService } from '../../prisma.service';

@Controller('internal/ocpi')
@UseGuards(ServiceAuthGuard, ServiceScopeGuard)
export class OcpiInternalController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly commandsService: CommandsService
  ) {}

  // Locations
  @Get('locations')
  @ServiceScopes('ocpi:read')
  getLocations() {
    return this.prisma.station.findMany({ include: { chargePoints: true, site: true } });
  }

  @Get('locations/:id')
  @ServiceScopes('ocpi:read')
  getLocation(@Param('id') id: string) {
    return this.prisma.station.findUnique({ where: { id }, include: { chargePoints: true, site: true } });
  }

  // Tariffs
  @Get('tariffs')
  @ServiceScopes('ocpi:read')
  getTariffs() {
    return [];
  }

  @Post('tariffs')
  @ServiceScopes('ocpi:write')
  createTariff(@Body() payload: any) {
    return payload;
  }

  @Put('tariffs/:id')
  @ServiceScopes('ocpi:write')
  updateTariff(@Param('id') id: string, @Body() payload: any) {
    return { id, ...payload };
  }

  @Post('partner-locations')
  @ServiceScopes('ocpi:write')
  async upsertPartnerLocation(@Body() payload: any) {
    return this.upsertLocation(payload, false);
  }

  @Patch('partner-locations')
  @ServiceScopes('ocpi:write')
  async patchPartnerLocation(@Body() payload: any) {
    return this.upsertLocation(payload, true);
  }

  @Get('partner-locations')
  @ServiceScopes('ocpi:read')
  async listPartnerLocations() {
    return this.prisma.ocpiPartnerLocation.findMany({ orderBy: { updatedAt: 'desc' } });
  }

  @Post('partner-tariffs')
  @ServiceScopes('ocpi:write')
  async upsertPartnerTariff(@Body() payload: any) {
    const countryCode = payload.countryCode;
    const partyId = payload.partyId;
    const tariffId = payload.tariffId;
    const version = payload.version || '2.2.1';
    const data = payload.data;
    const lastUpdated = payload.lastUpdated ? new Date(payload.lastUpdated) : new Date();

    if (!countryCode || !partyId || !tariffId || !data) {
      throw new NotImplementedException('Missing required tariff fields');
    }

    const existing = await this.prisma.ocpiPartnerTariff.findUnique({
      where: {
        countryCode_partyId_tariffId_version: {
          countryCode,
          partyId,
          tariffId,
          version,
        },
      },
    });

    if (existing) {
      return this.prisma.ocpiPartnerTariff.update({
        where: { id: existing.id },
        data: {
          data,
          lastUpdated,
        },
      });
    }

    return this.prisma.ocpiPartnerTariff.create({
      data: {
        countryCode,
        partyId,
        tariffId,
        version,
        data,
        lastUpdated,
      },
    });
  }

  @Get('partner-tariffs')
  @ServiceScopes('ocpi:read')
  async listPartnerTariffs() {
    return this.prisma.ocpiPartnerTariff.findMany({ orderBy: { updatedAt: 'desc' } });
  }

  // Tokens
  @Get('tokens')
  @ServiceScopes('ocpi:read')
  async getTokens() {
    return this.prisma.ocpiToken.findMany({ orderBy: { updatedAt: 'desc' } });
  }

  @Post('tokens')
  @ServiceScopes('ocpi:write')
  async upsertToken(@Body() payload: any) {
    const countryCode = payload.countryCode;
    const partyId = payload.partyId;
    const tokenUid = payload.tokenUid;
    const tokenType = payload.tokenType || 'RFID';
    const data = payload.data;
    const lastUpdated = payload.lastUpdated ? new Date(payload.lastUpdated) : new Date();
    const valid = payload.valid !== undefined ? Boolean(payload.valid) : true;

    if (!countryCode || !partyId || !tokenUid || !data) {
      throw new NotImplementedException('Missing required token fields');
    }

    const existing = await this.prisma.ocpiToken.findUnique({
      where: {
        countryCode_partyId_tokenUid_tokenType: {
          countryCode,
          partyId,
          tokenUid,
          tokenType,
        },
      },
    });

    if (existing) {
      return this.prisma.ocpiToken.update({
        where: { id: existing.id },
        data: {
          data,
          lastUpdated,
          valid,
        },
      });
    }

    return this.prisma.ocpiToken.create({
      data: {
        countryCode,
        partyId,
        tokenUid,
        tokenType,
        data,
        lastUpdated,
        valid,
      },
    });
  }

  @Post('tokens/authorize')
  @ServiceScopes('ocpi:write')
  async authorizeToken(@Body() payload: any) {
    const tokenUid = payload.tokenUid;
    const tokenType = payload.tokenType || 'RFID';
    const countryCode = payload.countryCode;
    const partyId = payload.partyId;

    if (!tokenUid) {
      throw new NotImplementedException('tokenUid is required');
    }

    const token = await this.prisma.ocpiToken.findFirst({
      where: {
        tokenUid,
        tokenType,
        ...(countryCode ? { countryCode } : {}),
        ...(partyId ? { partyId } : {}),
      },
    });

    if (!token) {
      return null;
    }

    return {
      allowed: token.valid ? 'ALLOWED' : 'BLOCKED',
      token: token.data,
      location: payload.location || null,
      authorization_reference: payload.authorizationReference || null,
    };
  }

  @Post('partner-tokens')
  @ServiceScopes('ocpi:write')
  async upsertPartnerToken(@Body() payload: any) {
    const countryCode = payload.countryCode;
    const partyId = payload.partyId;
    const tokenUid = payload.tokenUid;
    const tokenType = payload.tokenType || 'RFID';
    const version = payload.version || '2.2.1';
    const data = payload.data;
    const lastUpdated = payload.lastUpdated ? new Date(payload.lastUpdated) : new Date();

    if (!countryCode || !partyId || !tokenUid || !data) {
      throw new NotImplementedException('Missing required token fields');
    }

    const existing = await this.prisma.ocpiPartnerToken.findUnique({
      where: {
        countryCode_partyId_tokenUid_tokenType_version: {
          countryCode,
          partyId,
          tokenUid,
          tokenType,
          version,
        },
      },
    });

    if (existing) {
      return this.prisma.ocpiPartnerToken.update({
        where: { id: existing.id },
        data: {
          data,
          lastUpdated,
        },
      });
    }

    return this.prisma.ocpiPartnerToken.create({
      data: {
        countryCode,
        partyId,
        tokenUid,
        tokenType,
        version,
        data,
        lastUpdated,
      },
    });
  }

  @Get('partner-tokens')
  @ServiceScopes('ocpi:read')
  async listPartnerTokens(@Query() query: any) {
    const where: any = {};
    if (query.countryCode) where.countryCode = query.countryCode;
    if (query.partyId) where.partyId = query.partyId;
    if (query.tokenUid) where.tokenUid = query.tokenUid;
    if (query.tokenType) where.tokenType = query.tokenType;
    if (query.version) where.version = query.version;

    return this.prisma.ocpiPartnerToken.findMany({ where, orderBy: { updatedAt: 'desc' } });
  }

  // Sessions
  @Post('sessions')
  @ServiceScopes('ocpi:write')
  async createSession(@Body() payload: any) {
    const countryCode = payload.countryCode;
    const partyId = payload.partyId;
    const sessionId = payload.sessionId;
    const version = payload.version || '2.2.1';
    const data = payload.data;
    const lastUpdated = payload.lastUpdated ? new Date(payload.lastUpdated) : new Date();

    if (!countryCode || !partyId || !sessionId || !data) {
      throw new NotImplementedException('Missing required session fields');
    }

    const existing = await this.prisma.ocpiPartnerSession.findUnique({
      where: {
        countryCode_partyId_sessionId_version: {
          countryCode,
          partyId,
          sessionId,
          version,
        },
      },
    });

    if (existing) {
      return this.prisma.ocpiPartnerSession.update({
        where: { id: existing.id },
        data: {
          data,
          lastUpdated,
        },
      });
    }

    return this.prisma.ocpiPartnerSession.create({
      data: {
        countryCode,
        partyId,
        sessionId,
        version,
        data,
        lastUpdated,
      },
    });
  }

  @Patch('sessions/:id')
  @ServiceScopes('ocpi:write')
  async updateSession(@Param('id') id: string, @Body() payload: any) {
    return this.prisma.session.update({
      where: { id },
      data: payload,
    });
  }

  @Get('sessions')
  @ServiceScopes('ocpi:read')
  async listSessions() {
    return this.prisma.session.findMany({ orderBy: { startTime: 'desc' } });
  }

  @Get('sessions/:id')
  @ServiceScopes('ocpi:read')
  async getSession(@Param('id') id: string) {
    return this.prisma.session.findUnique({ where: { id } });
  }

  @Post('partner-sessions')
  @ServiceScopes('ocpi:write')
  async upsertPartnerSession(@Body() payload: any) {
    return this.createSession(payload);
  }

  @Get('partner-sessions')
  @ServiceScopes('ocpi:read')
  async listPartnerSessions(@Query() query: any) {
    const where: any = {};
    if (query.countryCode) where.countryCode = query.countryCode;
    if (query.partyId) where.partyId = query.partyId;
    if (query.sessionId) where.sessionId = query.sessionId;
    if (query.version) where.version = query.version;

    return this.prisma.ocpiPartnerSession.findMany({ where, orderBy: { updatedAt: 'desc' } });
  }

  // CDRs
  @Post('cdrs')
  @ServiceScopes('ocpi:write')
  async createCdr(@Body() payload: any) {
    const countryCode = payload.countryCode;
    const partyId = payload.partyId;
    const cdrId = payload.cdrId;
    const version = payload.version || '2.2.1';
    const data = payload.data;
    const lastUpdated = payload.lastUpdated ? new Date(payload.lastUpdated) : new Date();

    if (!countryCode || !partyId || !cdrId || !data) {
      throw new NotImplementedException('Missing required CDR fields');
    }

    const existing = await this.prisma.ocpiPartnerCdr.findUnique({
      where: {
        countryCode_partyId_cdrId_version: {
          countryCode,
          partyId,
          cdrId,
          version,
        },
      },
    });

    if (existing) {
      return this.prisma.ocpiPartnerCdr.update({
        where: { id: existing.id },
        data: {
          data,
          lastUpdated,
        },
      });
    }

    return this.prisma.ocpiPartnerCdr.create({
      data: {
        countryCode,
        partyId,
        cdrId,
        version,
        data,
        lastUpdated,
      },
    });
  }

  @Get('cdrs')
  @ServiceScopes('ocpi:read')
  async listCdrs() {
    return this.prisma.ocpiPartnerCdr.findMany({ orderBy: { updatedAt: 'desc' } });
  }

  // Commands
  @Post('commands')
  @ServiceScopes('ocpi:commands')
  createCommand(@Body() payload: any) {
    return this.commandsService.enqueueCommand(payload);
  }

  @Get('commands/:id')
  @ServiceScopes('ocpi:read')
  async getCommand(@Param('id') id: string) {
    const command = await this.commandsService.getCommandById(id);
    if (!command) {
      return { id, status: 'NOT_FOUND' };
    }
    return command;
  }

  // Partner registry
  @Post('partners')
  @ServiceScopes('ocpi:write')
  async createPartner(@Body() payload: any) {
    return this.prisma.ocpiPartner.create({
      data: {
        name: payload.name,
        partyId: payload.partyId,
        countryCode: payload.countryCode,
        role: payload.role,
        status: payload.status || 'PENDING',
        versionsUrl: payload.versionsUrl || null,
        tokenA: payload.tokenA || null,
        tokenB: payload.tokenB || null,
        tokenC: payload.tokenC || null,
        roles: payload.roles || undefined,
        endpoints: payload.endpoints || undefined,
        lastSyncAt: payload.lastSyncAt ? new Date(payload.lastSyncAt) : undefined,
      },
    });
  }

  @Patch('partners/:id')
  @ServiceScopes('ocpi:write')
  async updatePartner(@Param('id') id: string, @Body() payload: any) {
    return this.prisma.ocpiPartner.update({
      where: { id },
      data: {
        name: payload.name,
        partyId: payload.partyId,
        countryCode: payload.countryCode,
        role: payload.role,
        status: payload.status,
        versionsUrl: payload.versionsUrl,
        tokenA: payload.tokenA,
        tokenB: payload.tokenB,
        tokenC: payload.tokenC,
        roles: payload.roles,
        endpoints: payload.endpoints,
        lastSyncAt: payload.lastSyncAt ? new Date(payload.lastSyncAt) : undefined,
      },
    });
  }

  @Get('partners')
  @ServiceScopes('ocpi:read')
  async listPartners(@Query('token') token?: string) {
    if (token) {
      return this.prisma.ocpiPartner.findMany({
        where: {
          OR: [{ tokenA: token }, { tokenB: token }, { tokenC: token }],
        },
      });
    }
    return this.prisma.ocpiPartner.findMany({ orderBy: { createdAt: 'desc' } });
  }

  @Get('partners/:id')
  @ServiceScopes('ocpi:read')
  async getPartner(@Param('id') id: string) {
    return this.prisma.ocpiPartner.findUnique({ where: { id } });
  }

  private async upsertLocation(payload: any, isPatch: boolean) {
    const countryCode = payload.countryCode;
    const partyId = payload.partyId;
    const locationId = payload.locationId;
    const version = payload.version || '2.2.1';
    const data = payload.data;
    const lastUpdated = payload.lastUpdated ? new Date(payload.lastUpdated) : new Date();
    const objectType = payload.objectType || 'LOCATION';
    const evseUid = payload.evseUid;
    const connectorId = payload.connectorId;

    if (!countryCode || !partyId || !locationId || !data) {
      throw new NotImplementedException('Missing required location fields');
    }

    const existing = await this.prisma.ocpiPartnerLocation.findUnique({
      where: {
        countryCode_partyId_locationId_version: {
          countryCode,
          partyId,
          locationId,
          version,
        },
      },
    });

    if (!existing) {
      if (objectType !== 'LOCATION') {
        throw new NotImplementedException('Location not found for EVSE/Connector update');
      }

      return this.prisma.ocpiPartnerLocation.create({
        data: {
          countryCode,
          partyId,
          locationId,
          version,
          data,
          lastUpdated,
        },
      });
    }

    const merged = this.mergeLocation(existing.data as any, data, {
      objectType,
      evseUid,
      connectorId,
      isPatch,
    });

    return this.prisma.ocpiPartnerLocation.update({
      where: { id: existing.id },
      data: {
        data: merged,
        lastUpdated,
      },
    });
  }

  private mergeLocation(
    existing: any,
    incoming: any,
    context: { objectType: string; evseUid?: string; connectorId?: string; isPatch: boolean }
  ) {
    const { objectType, evseUid, connectorId, isPatch } = context;

    if (objectType === 'LOCATION') {
      return isPatch ? { ...existing, ...incoming } : incoming;
    }

    const updated = { ...existing };
    const evses = Array.isArray(updated.evses) ? [...updated.evses] : [];

    if (objectType === 'EVSE') {
      if (!evseUid && !incoming?.uid) {
        return updated;
      }
      const uid = evseUid || incoming.uid;
      const index = evses.findIndex((evse: any) => evse.uid === uid);
      if (index === -1) {
        evses.push(incoming);
      } else {
        evses[index] = isPatch ? { ...evses[index], ...incoming } : incoming;
      }
      updated.evses = evses;
      return updated;
    }

    if (objectType === 'CONNECTOR') {
      if (!evseUid || !connectorId) {
        return updated;
      }
      const evseIndex = evses.findIndex((evse: any) => evse.uid === evseUid);
      if (evseIndex === -1) {
        return updated;
      }
      const evse = evses[evseIndex];
      const connectors = Array.isArray(evse.connectors) ? [...evse.connectors] : [];
      const connectorIndex = connectors.findIndex((connector: any) => connector.id === connectorId);
      if (connectorIndex === -1) {
        connectors.push(incoming);
      } else {
        connectors[connectorIndex] = isPatch ? { ...connectors[connectorIndex], ...incoming } : incoming;
      }
      evses[evseIndex] = { ...evse, connectors };
      updated.evses = evses;
      return updated;
    }

    return updated;
  }
}
