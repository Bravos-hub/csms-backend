import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import { ServiceAuthGuard } from '../auth/service-auth.guard';
import { ServiceScopeGuard } from '../auth/service-scope.guard';
import { ServiceScopes } from '../auth/service-scopes.decorator';
import { CommandsService } from '../commands/commands.service';
import {
  OcpiInternalCommandRequestDto,
  OcpiInternalCommandResultDto,
  OcpiListQueryDto,
  OcpiPartnerCdrQueryDto,
  OcpiPartnerCdrUpsertDto,
  OcpiPartnerCreateDto,
  OcpiPartnerLocationUpsertDto,
  OcpiPartnerQueryDto,
  OcpiPartnerSessionQueryDto,
  OcpiPartnerSessionUpsertDto,
  OcpiPartnerTariffDeleteDto,
  OcpiPartnerTariffUpsertDto,
  OcpiPartnerTokenQueryDto,
  OcpiPartnerTokenUpsertDto,
  OcpiPartnerUpdateDto,
  OcpiSessionChargingPreferencesDto,
  OcpiTokenAuthorizeDto,
  OcpiTokenUpsertDto,
} from './dto/ocpi-internal.dto';

@Controller('internal/ocpi')
@UseGuards(ServiceAuthGuard, ServiceScopeGuard)
export class OcpiInternalController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly commandsService: CommandsService,
    private readonly config: ConfigService,
  ) {}

  // Locations
  @Get('locations')
  @ServiceScopes('ocpi:read')
  getLocations() {
    return this.prisma.station.findMany({
      include: { chargePoints: true, site: true },
    });
  }

  @Get('locations/:id')
  @ServiceScopes('ocpi:read')
  getLocation(@Param('id') id: string) {
    return this.prisma.station.findUnique({
      where: { id },
      include: { chargePoints: true, site: true },
    });
  }

  @Post('partner-locations')
  @ServiceScopes('ocpi:write')
  async upsertPartnerLocation(@Body() payload: OcpiPartnerLocationUpsertDto) {
    return this.upsertLocation(payload, false);
  }

  @Patch('partner-locations')
  @ServiceScopes('ocpi:write')
  async patchPartnerLocation(@Body() payload: OcpiPartnerLocationUpsertDto) {
    return this.upsertLocation(payload, true);
  }

  @Get('partner-locations')
  @ServiceScopes('ocpi:read')
  async listPartnerLocations(@Query() query: OcpiListQueryDto) {
    return this.prisma.ocpiPartnerLocation.findMany({
      orderBy: { updatedAt: 'desc' },
      take: query.limit || undefined,
      skip: query.offset || undefined,
    });
  }

  // Tariffs
  @Get('tariffs')
  @ServiceScopes('ocpi:read')
  async getTariffs(@Query() query: OcpiListQueryDto) {
    const rows = await this.prisma.ocpiPartnerTariff.findMany({
      orderBy: { updatedAt: 'desc' },
      take: query.limit || undefined,
      skip: query.offset || undefined,
    });
    return rows.map((row) => row.data);
  }

  @Post('partner-tariffs')
  @ServiceScopes('ocpi:write')
  async upsertPartnerTariff(@Body() payload: OcpiPartnerTariffUpsertDto) {
    const version = payload.version || '2.2.1';
    const lastUpdated = this.parseDate(payload.lastUpdated);

    const existing = await this.prisma.ocpiPartnerTariff.findUnique({
      where: {
        countryCode_partyId_tariffId_version: {
          countryCode: payload.countryCode,
          partyId: payload.partyId,
          tariffId: payload.tariffId,
          version,
        },
      },
      select: { id: true },
    });

    if (existing) {
      return this.prisma.ocpiPartnerTariff.update({
        where: { id: existing.id },
        data: {
          data: payload.data as Prisma.InputJsonValue,
          lastUpdated,
        },
      });
    }

    return this.prisma.ocpiPartnerTariff.create({
      data: {
        countryCode: payload.countryCode,
        partyId: payload.partyId,
        tariffId: payload.tariffId,
        version,
        data: payload.data as Prisma.InputJsonValue,
        lastUpdated,
      },
    });
  }

  @Post('partner-tariffs/delete')
  @ServiceScopes('ocpi:write')
  async deletePartnerTariff(@Body() payload: OcpiPartnerTariffDeleteDto) {
    const version = payload.version || '2.2.1';

    const existing = await this.prisma.ocpiPartnerTariff.findUnique({
      where: {
        countryCode_partyId_tariffId_version: {
          countryCode: payload.countryCode,
          partyId: payload.partyId,
          tariffId: payload.tariffId,
          version,
        },
      },
      select: { id: true },
    });

    if (!existing) {
      return {
        deleted: false,
        countryCode: payload.countryCode,
        partyId: payload.partyId,
        tariffId: payload.tariffId,
        version,
      };
    }

    await this.prisma.ocpiPartnerTariff.delete({ where: { id: existing.id } });
    return {
      deleted: true,
      countryCode: payload.countryCode,
      partyId: payload.partyId,
      tariffId: payload.tariffId,
      version,
    };
  }

  @Get('partner-tariffs')
  @ServiceScopes('ocpi:read')
  async listPartnerTariffs(@Query() query: OcpiListQueryDto) {
    return this.prisma.ocpiPartnerTariff.findMany({
      orderBy: { updatedAt: 'desc' },
      take: query.limit || undefined,
      skip: query.offset || undefined,
    });
  }

  // Tokens
  @Get('tokens')
  @ServiceScopes('ocpi:read')
  async getTokens(@Query() query: OcpiListQueryDto) {
    return this.prisma.ocpiToken.findMany({
      orderBy: { updatedAt: 'desc' },
      take: query.limit || undefined,
      skip: query.offset || undefined,
    });
  }

  @Post('tokens')
  @ServiceScopes('ocpi:write')
  async upsertToken(@Body() payload: OcpiTokenUpsertDto) {
    const tokenType = payload.tokenType || 'RFID';
    const lastUpdated = this.parseDate(payload.lastUpdated);
    const valid =
      payload.valid !== undefined ? Boolean(payload.valid) : Boolean(true);

    const existing = await this.prisma.ocpiToken.findUnique({
      where: {
        countryCode_partyId_tokenUid_tokenType: {
          countryCode: payload.countryCode,
          partyId: payload.partyId,
          tokenUid: payload.tokenUid,
          tokenType,
        },
      },
      select: { id: true },
    });

    if (existing) {
      return this.prisma.ocpiToken.update({
        where: { id: existing.id },
        data: {
          data: payload.data as Prisma.InputJsonValue,
          lastUpdated,
          valid,
        },
      });
    }

    return this.prisma.ocpiToken.create({
      data: {
        countryCode: payload.countryCode,
        partyId: payload.partyId,
        tokenUid: payload.tokenUid,
        tokenType,
        data: payload.data as Prisma.InputJsonValue,
        lastUpdated,
        valid,
      },
    });
  }

  @Post('tokens/authorize')
  @ServiceScopes('ocpi:write')
  async authorizeToken(@Body() payload: OcpiTokenAuthorizeDto) {
    const tokenType = payload.tokenType || 'RFID';
    const token = await this.prisma.ocpiToken.findFirst({
      where: {
        tokenUid: payload.tokenUid,
        tokenType,
        ...(payload.countryCode ? { countryCode: payload.countryCode } : {}),
        ...(payload.partyId ? { partyId: payload.partyId } : {}),
      },
      orderBy: { updatedAt: 'desc' },
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
  async upsertPartnerToken(@Body() payload: OcpiPartnerTokenUpsertDto) {
    const tokenType = payload.tokenType || 'RFID';
    const version = payload.version || '2.2.1';
    const lastUpdated = this.parseDate(payload.lastUpdated);

    const existing = await this.prisma.ocpiPartnerToken.findUnique({
      where: {
        countryCode_partyId_tokenUid_tokenType_version: {
          countryCode: payload.countryCode,
          partyId: payload.partyId,
          tokenUid: payload.tokenUid,
          tokenType,
          version,
        },
      },
      select: { id: true },
    });

    if (existing) {
      return this.prisma.ocpiPartnerToken.update({
        where: { id: existing.id },
        data: {
          data: payload.data as Prisma.InputJsonValue,
          lastUpdated,
        },
      });
    }

    return this.prisma.ocpiPartnerToken.create({
      data: {
        countryCode: payload.countryCode,
        partyId: payload.partyId,
        tokenUid: payload.tokenUid,
        tokenType,
        version,
        data: payload.data as Prisma.InputJsonValue,
        lastUpdated,
      },
    });
  }

  @Get('partner-tokens')
  @ServiceScopes('ocpi:read')
  async listPartnerTokens(@Query() query: OcpiPartnerTokenQueryDto) {
    const where: Prisma.OcpiPartnerTokenWhereInput = {};
    if (query.countryCode) where.countryCode = query.countryCode;
    if (query.partyId) where.partyId = query.partyId;
    if (query.tokenUid) where.tokenUid = query.tokenUid;
    if (query.tokenType) where.tokenType = query.tokenType;
    if (query.version) where.version = query.version;

    return this.prisma.ocpiPartnerToken.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
    });
  }

  // Sessions
  @Post('sessions')
  @ServiceScopes('ocpi:write')
  async createSession(@Body() payload: OcpiPartnerSessionUpsertDto) {
    const version = payload.version || '2.2.1';
    const lastUpdated = this.parseDate(payload.lastUpdated);

    const existing = await this.prisma.ocpiPartnerSession.findUnique({
      where: {
        countryCode_partyId_sessionId_version: {
          countryCode: payload.countryCode,
          partyId: payload.partyId,
          sessionId: payload.sessionId,
          version,
        },
      },
      select: { id: true },
    });

    if (existing) {
      return this.prisma.ocpiPartnerSession.update({
        where: { id: existing.id },
        data: {
          data: payload.data as Prisma.InputJsonValue,
          lastUpdated,
        },
      });
    }

    return this.prisma.ocpiPartnerSession.create({
      data: {
        countryCode: payload.countryCode,
        partyId: payload.partyId,
        sessionId: payload.sessionId,
        version,
        data: payload.data as Prisma.InputJsonValue,
        lastUpdated,
      },
    });
  }

  @Put('sessions/:sessionId/charging-preferences')
  @ServiceScopes('ocpi:write')
  async setChargingPreferences(
    @Param('sessionId') sessionId: string,
    @Body() payload: OcpiSessionChargingPreferencesDto,
  ) {
    const normalizedSessionId = sessionId.trim();
    if (!normalizedSessionId) {
      throw new BadRequestException('sessionId is required');
    }

    const updatedAt = this.parseDate(payload.updatedAt);
    const existing = await this.prisma.ocpiPartnerSession.findFirst({
      where: { sessionId: normalizedSessionId },
      orderBy: { updatedAt: 'desc' },
    });

    if (existing) {
      const existingData = this.ensureObject(existing.data);
      const merged = {
        ...existingData,
        charging_preferences: payload.data,
        last_updated: updatedAt.toISOString(),
      };
      const updated = await this.prisma.ocpiPartnerSession.update({
        where: { id: existing.id },
        data: {
          data: merged as Prisma.InputJsonValue,
          lastUpdated: updatedAt,
        },
      });
      return {
        sessionId: normalizedSessionId,
        updatedAt: updatedAt.toISOString(),
        version: updated.version,
        countryCode: updated.countryCode,
        partyId: updated.partyId,
      };
    }

    const fallbackCountryCode = (
      this.extractString(payload.data, 'country_code') ||
      this.defaultCountryCode()
    )?.toUpperCase();
    const fallbackPartyId = (
      this.extractString(payload.data, 'party_id') || this.defaultPartyId()
    )?.toUpperCase();

    const created = await this.prisma.ocpiPartnerSession.create({
      data: {
        countryCode: fallbackCountryCode,
        partyId: fallbackPartyId,
        sessionId: normalizedSessionId,
        version: payload.version || '2.2.1',
        data: {
          id: normalizedSessionId,
          charging_preferences: payload.data,
          last_updated: updatedAt.toISOString(),
        } as Prisma.InputJsonValue,
        lastUpdated: updatedAt,
      },
    });

    return {
      sessionId: normalizedSessionId,
      updatedAt: updatedAt.toISOString(),
      version: created.version,
      countryCode: created.countryCode,
      partyId: created.partyId,
    };
  }

  @Patch('sessions/:id')
  @ServiceScopes('ocpi:write')
  async updateSession(
    @Param('id') id: string,
    @Body() payload: Record<string, unknown>,
  ) {
    return this.prisma.session.update({
      where: { id },
      data: payload,
    });
  }

  @Get('sessions')
  @ServiceScopes('ocpi:read')
  async listSessions(@Query() query: OcpiListQueryDto) {
    return this.prisma.session.findMany({
      orderBy: { startTime: 'desc' },
      take: query.limit || undefined,
      skip: query.offset || undefined,
    });
  }

  @Get('sessions/:id')
  @ServiceScopes('ocpi:read')
  async getSession(@Param('id') id: string) {
    return this.prisma.session.findUnique({ where: { id } });
  }

  @Post('partner-sessions')
  @ServiceScopes('ocpi:write')
  async upsertPartnerSession(@Body() payload: OcpiPartnerSessionUpsertDto) {
    return this.createSession(payload);
  }

  @Get('partner-sessions')
  @ServiceScopes('ocpi:read')
  async listPartnerSessions(@Query() query: OcpiPartnerSessionQueryDto) {
    const where: Prisma.OcpiPartnerSessionWhereInput = {};
    if (query.countryCode) where.countryCode = query.countryCode;
    if (query.partyId) where.partyId = query.partyId;
    if (query.sessionId) where.sessionId = query.sessionId;
    if (query.version) where.version = query.version;

    return this.prisma.ocpiPartnerSession.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
    });
  }

  // CDRs
  @Post('cdrs')
  @ServiceScopes('ocpi:write')
  async createCdr(@Body() payload: OcpiPartnerCdrUpsertDto) {
    const version = payload.version || '2.2.1';
    const lastUpdated = this.parseDate(payload.lastUpdated);

    const existing = await this.prisma.ocpiPartnerCdr.findUnique({
      where: {
        countryCode_partyId_cdrId_version: {
          countryCode: payload.countryCode,
          partyId: payload.partyId,
          cdrId: payload.cdrId,
          version,
        },
      },
      select: { id: true },
    });

    if (existing) {
      return this.prisma.ocpiPartnerCdr.update({
        where: { id: existing.id },
        data: {
          data: payload.data as Prisma.InputJsonValue,
          lastUpdated,
        },
      });
    }

    return this.prisma.ocpiPartnerCdr.create({
      data: {
        countryCode: payload.countryCode,
        partyId: payload.partyId,
        cdrId: payload.cdrId,
        version,
        data: payload.data as Prisma.InputJsonValue,
        lastUpdated,
      },
    });
  }

  @Get('cdrs')
  @ServiceScopes('ocpi:read')
  async listCdrs(@Query() query: OcpiPartnerCdrQueryDto) {
    const where: Prisma.OcpiPartnerCdrWhereInput = {};
    if (query.countryCode) where.countryCode = query.countryCode;
    if (query.partyId) where.partyId = query.partyId;
    if (query.cdrId) where.cdrId = query.cdrId;
    if (query.version) where.version = query.version;

    return this.prisma.ocpiPartnerCdr.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
    });
  }

  @Get('cdrs/:cdrId')
  @ServiceScopes('ocpi:read')
  async getCdr(@Param('cdrId') cdrId: string) {
    const record = await this.prisma.ocpiPartnerCdr.findFirst({
      where: { cdrId },
      orderBy: { updatedAt: 'desc' },
    });
    if (!record) {
      return null;
    }
    return record.data;
  }

  // Commands
  @Post('commands/requests')
  @ServiceScopes('ocpi:commands')
  async createCommandRequest(@Body() payload: OcpiInternalCommandRequestDto) {
    const command = payload.command.toUpperCase();

    if (command === 'RESERVE_NOW' || command === 'CANCEL_RESERVATION') {
      return {
        result: 'NOT_SUPPORTED',
        requestId: payload.requestId,
      };
    }

    const mappedCommandType = this.mapOcpiCommandToCpmsCommand(command);
    if (!mappedCommandType) {
      return {
        result: 'NOT_SUPPORTED',
        requestId: payload.requestId,
      };
    }

    const duplicate = await this.prisma.command.findFirst({
      where: { correlationId: payload.requestId },
      select: { id: true, status: true },
      orderBy: { requestedAt: 'desc' },
    });

    if (duplicate) {
      return {
        result: 'ACCEPTED',
        requestId: payload.requestId,
        commandId: duplicate.id,
      };
    }

    const requestBody = this.ensureObject(payload.request);
    const chargePoint =
      await this.resolveChargePointForOcpiCommand(requestBody);

    if (!chargePoint) {
      return {
        result: 'REJECTED',
        requestId: payload.requestId,
        message: 'Unable to resolve a target charge point',
      };
    }

    const connectorId =
      this.extractNumber(requestBody, 'connector_id') ||
      this.extractNumber(requestBody, 'connectorId') ||
      this.extractNumber(requestBody, 'evse_id') ||
      this.extractNumber(requestBody, 'evseId') ||
      undefined;

    const mappedPayload = this.mapOcpiCommandPayload(
      command,
      requestBody,
      connectorId,
    );
    const responseUrl =
      this.extractString(requestBody, 'response_url') ||
      this.extractString(requestBody, 'responseUrl') ||
      null;

    const enqueue = await this.commandsService.enqueueCommand({
      commandType: mappedCommandType,
      chargePointId: chargePoint.id,
      stationId: chargePoint.stationId,
      connectorId,
      payload: {
        ...mappedPayload,
        ocpi: {
          version: payload.version,
          role: payload.role,
          command,
          requestId: payload.requestId,
          responseUrl,
          partnerId: payload.partnerId || null,
          requestedAt: payload.requestedAt || new Date().toISOString(),
          originalRequest: requestBody,
        },
      },
      requestedBy: {
        userId: 'ocpi-gateway',
        role: 'SERVICE',
      },
      correlationId: payload.requestId,
    });

    return {
      result: 'ACCEPTED',
      timeout: 30,
      requestId: payload.requestId,
      commandId: enqueue.commandId,
    };
  }

  @Post('commands/results')
  @ServiceScopes('ocpi:commands')
  async createCommandResult(@Body() payload: OcpiInternalCommandResultDto) {
    const command = await this.prisma.command.findFirst({
      where: { correlationId: payload.requestId },
      orderBy: { requestedAt: 'desc' },
      select: {
        id: true,
        status: true,
        payload: true,
      },
    });

    if (!command) {
      return {
        updated: false,
        requestId: payload.requestId,
      };
    }

    const mappedStatus = this.mapOcpiResultToCommandStatus(payload.result);
    const occurredAt = this.parseDate(payload.occurredAt);
    const error = this.extractOcpiResultError(payload.result);
    const isTerminal = ['Accepted', 'Rejected', 'Failed', 'Timeout'].includes(
      mappedStatus,
    );

    if (command.status === mappedStatus && isTerminal) {
      return {
        updated: false,
        requestId: payload.requestId,
        commandId: command.id,
        status: command.status,
      };
    }

    const existingPayload = this.ensureObject(command.payload);
    const existingOcpi = this.ensureObject(existingPayload.ocpi);
    const nextPayload = {
      ...existingPayload,
      ocpi: {
        ...existingOcpi,
        latestResult: payload.result,
        latestResultAt: occurredAt.toISOString(),
      },
    };

    await this.prisma.$transaction(async (tx) => {
      await tx.command.update({
        where: { id: command.id },
        data: {
          status: mappedStatus,
          completedAt: isTerminal ? occurredAt : null,
          error: error || null,
          payload: nextPayload as Prisma.InputJsonValue,
        },
      });

      await tx.commandEvent.create({
        data: {
          commandId: command.id,
          status: mappedStatus,
          payload: {
            source: 'ocpi.command.result',
            requestId: payload.requestId,
            command: payload.command,
            result: payload.result,
            role: payload.role,
            version: payload.version,
          } as Prisma.InputJsonValue,
          occurredAt,
        },
      });
    });

    return {
      updated: true,
      requestId: payload.requestId,
      commandId: command.id,
      status: mappedStatus,
    };
  }

  @Post('commands')
  @ServiceScopes('ocpi:commands')
  createCommand(@Body() payload: Record<string, unknown>) {
    const commandType = this.extractString(payload, 'commandType');
    if (!commandType) {
      throw new BadRequestException('commandType is required');
    }

    const requestedBy = this.ensureObject(payload.requestedBy);
    return this.commandsService.enqueueCommand({
      stationId: this.extractString(payload, 'stationId') || undefined,
      chargePointId: this.extractString(payload, 'chargePointId') || undefined,
      connectorId: this.extractNumber(payload, 'connectorId') || undefined,
      commandType,
      payload: this.ensureObject(payload.payload),
      requestedBy: {
        userId: this.extractString(requestedBy, 'userId') || undefined,
        role: this.extractString(requestedBy, 'role') || undefined,
        orgId: this.extractString(requestedBy, 'orgId') || undefined,
      },
      correlationId: this.extractString(payload, 'correlationId') || undefined,
    });
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
  async createPartner(@Body() payload: OcpiPartnerCreateDto) {
    return this.prisma.ocpiPartner.create({
      data: {
        name: payload.name,
        partyId: payload.partyId,
        countryCode: payload.countryCode,
        role: payload.role,
        status: payload.status || 'PENDING',
        version: payload.version || '2.2.1',
        versionsUrl: payload.versionsUrl || null,
        tokenA: payload.tokenA || null,
        tokenB: payload.tokenB || null,
        tokenC: payload.tokenC || null,
        roles: payload.roles
          ? (payload.roles as Prisma.InputJsonValue)
          : undefined,
        endpoints: payload.endpoints
          ? (payload.endpoints as Prisma.InputJsonValue)
          : undefined,
        lastSyncAt: payload.lastSyncAt
          ? this.parseDate(payload.lastSyncAt)
          : undefined,
      },
    });
  }

  @Patch('partners/:id')
  @ServiceScopes('ocpi:write')
  async updatePartner(
    @Param('id') id: string,
    @Body() payload: OcpiPartnerUpdateDto,
  ) {
    return this.prisma.ocpiPartner.update({
      where: { id },
      data: {
        name: payload.name,
        partyId: payload.partyId,
        countryCode: payload.countryCode,
        role: payload.role,
        status: payload.status,
        version: payload.version,
        versionsUrl: payload.versionsUrl,
        tokenA: payload.tokenA,
        tokenB: payload.tokenB,
        tokenC: payload.tokenC,
        roles: payload.roles
          ? (payload.roles as Prisma.InputJsonValue)
          : payload.roles,
        endpoints: payload.endpoints
          ? (payload.endpoints as Prisma.InputJsonValue)
          : payload.endpoints,
        lastSyncAt: payload.lastSyncAt
          ? this.parseDate(payload.lastSyncAt)
          : undefined,
      },
    });
  }

  @Get('partners')
  @ServiceScopes('ocpi:read')
  async listPartners(@Query() query: OcpiPartnerQueryDto) {
    if (query.token) {
      return this.prisma.ocpiPartner.findMany({
        where: {
          OR: [
            { tokenA: query.token },
            { tokenB: query.token },
            { tokenC: query.token },
          ],
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

  // Non-core modules are intentionally disabled for core v1 rollout.
  @Get('charging-profiles/:sessionId')
  @ServiceScopes('ocpi:read')
  getChargingProfile(@Param('sessionId') sessionId: string) {
    void sessionId;
    this.throwModuleNotSupported('ChargingProfiles');
  }

  @Put('charging-profiles/set')
  @ServiceScopes('ocpi:write')
  setChargingProfile(@Body() payload: Record<string, unknown>) {
    void payload;
    this.throwModuleNotSupported('ChargingProfiles');
  }

  @Post('charging-profiles/clear')
  @ServiceScopes('ocpi:write')
  clearChargingProfile(@Body() payload: Record<string, unknown>) {
    void payload;
    this.throwModuleNotSupported('ChargingProfiles');
  }

  @Post('charging-profiles/results')
  @ServiceScopes('ocpi:write')
  chargingProfileResult(@Body() payload: Record<string, unknown>) {
    void payload;
    this.throwModuleNotSupported('ChargingProfiles');
  }

  @Put('charging-profiles/active')
  @ServiceScopes('ocpi:write')
  activeChargingProfile(@Body() payload: Record<string, unknown>) {
    void payload;
    this.throwModuleNotSupported('ChargingProfiles');
  }

  @Get('hub-client-info')
  @ServiceScopes('ocpi:read')
  listHubClientInfo() {
    this.throwModuleNotSupported('HubClientInfo');
  }

  @Get('hub-client-info/object')
  @ServiceScopes('ocpi:read')
  getHubClientInfoObject() {
    this.throwModuleNotSupported('HubClientInfo');
  }

  @Put('hub-client-info')
  @ServiceScopes('ocpi:write')
  updateHubClientInfo(@Body() payload: Record<string, unknown>) {
    void payload;
    this.throwModuleNotSupported('HubClientInfo');
  }

  private async upsertLocation(
    payload: OcpiPartnerLocationUpsertDto,
    isPatch: boolean,
  ) {
    const version = payload.version || '2.2.1';
    const lastUpdated = this.parseDate(payload.lastUpdated);
    const objectType = payload.objectType || 'LOCATION';

    const existing = await this.prisma.ocpiPartnerLocation.findUnique({
      where: {
        countryCode_partyId_locationId_version: {
          countryCode: payload.countryCode,
          partyId: payload.partyId,
          locationId: payload.locationId,
          version,
        },
      },
    });

    if (!existing) {
      if (objectType !== 'LOCATION') {
        throw new NotFoundException(
          'Location not found for EVSE/Connector update',
        );
      }

      return this.prisma.ocpiPartnerLocation.create({
        data: {
          countryCode: payload.countryCode,
          partyId: payload.partyId,
          locationId: payload.locationId,
          version,
          data: payload.data as Prisma.InputJsonValue,
          lastUpdated,
        },
      });
    }

    const merged = this.mergeLocation(
      this.ensureObject(existing.data),
      payload.data,
      {
        objectType,
        evseUid: payload.evseUid,
        connectorId: payload.connectorId,
        isPatch,
      },
    );

    return this.prisma.ocpiPartnerLocation.update({
      where: { id: existing.id },
      data: {
        data: merged as Prisma.InputJsonValue,
        lastUpdated,
      },
    });
  }

  private mergeLocation(
    existing: Record<string, unknown>,
    incoming: Record<string, unknown>,
    context: {
      objectType: string;
      evseUid?: string;
      connectorId?: string;
      isPatch: boolean;
    },
  ) {
    const { objectType, evseUid, connectorId, isPatch } = context;

    if (objectType === 'LOCATION') {
      return isPatch ? { ...existing, ...incoming } : incoming;
    }

    const updated = { ...existing };
    const evses = Array.isArray(updated.evses)
      ? [...(updated.evses as Record<string, unknown>[])]
      : [];

    if (objectType === 'EVSE') {
      const uid = evseUid || this.extractString(incoming, 'uid');
      if (!uid) {
        return updated;
      }
      const index = evses.findIndex(
        (evse) => this.extractString(evse, 'uid') === uid,
      );
      if (index === -1) {
        evses.push(incoming);
      } else {
        evses[index] = isPatch ? { ...evses[index], ...incoming } : incoming;
      }
      return { ...updated, evses };
    }

    if (objectType === 'CONNECTOR') {
      if (!evseUid || !connectorId) {
        return updated;
      }
      const evseIndex = evses.findIndex(
        (evse) => this.extractString(evse, 'uid') === evseUid,
      );
      if (evseIndex === -1) {
        return updated;
      }

      const evse = this.ensureObject(evses[evseIndex]);
      const connectors = Array.isArray(evse.connectors)
        ? [...(evse.connectors as Record<string, unknown>[])]
        : [];
      const connectorIndex = connectors.findIndex(
        (connector) => this.extractString(connector, 'id') === connectorId,
      );
      if (connectorIndex === -1) {
        connectors.push(incoming);
      } else {
        connectors[connectorIndex] = isPatch
          ? { ...connectors[connectorIndex], ...incoming }
          : incoming;
      }

      evses[evseIndex] = { ...evse, connectors };
      return { ...updated, evses };
    }

    return updated;
  }

  private mapOcpiCommandToCpmsCommand(
    command: string,
  ): 'RemoteStart' | 'RemoteStop' | 'UnlockConnector' | null {
    if (command === 'START_SESSION') return 'RemoteStart';
    if (command === 'STOP_SESSION') return 'RemoteStop';
    if (command === 'UNLOCK_CONNECTOR') return 'UnlockConnector';
    return null;
  }

  private mapOcpiCommandPayload(
    command: string,
    request: Record<string, unknown>,
    connectorId?: number,
  ): Record<string, unknown> {
    if (command === 'START_SESSION') {
      const token = this.ensureObject(request.token);
      const idTag =
        this.extractString(token, 'uid') ||
        this.extractString(token, 'contract_id') ||
        this.extractString(request, 'authorization_reference') ||
        this.extractString(request, 'authorizationReference') ||
        'EVZONE_REMOTE';
      const remoteStartId =
        this.extractNumber(request, 'remote_start_id') ||
        this.extractNumber(request, 'remoteStartId') ||
        Math.floor(Date.now() / 1000);

      return {
        idTag,
        connectorId: connectorId || 1,
        evseId: connectorId || 1,
        remoteStartId,
      };
    }

    if (command === 'STOP_SESSION') {
      const transactionId =
        this.extractNumber(request, 'transaction_id') ||
        this.extractNumber(request, 'transactionId') ||
        this.extractNumber(request, 'session_id') ||
        this.extractNumber(request, 'sessionId');

      return {
        transactionId,
        sessionId:
          this.extractString(request, 'session_id') ||
          this.extractString(request, 'sessionId') ||
          null,
      };
    }

    if (command === 'UNLOCK_CONNECTOR') {
      return {
        connectorId: connectorId || 1,
        evseId: connectorId || 1,
      };
    }

    return {};
  }

  private mapOcpiResultToCommandStatus(
    result: Record<string, unknown>,
  ): 'Accepted' | 'Rejected' | 'Failed' | 'Timeout' {
    const normalized = (
      this.extractString(result, 'result') ||
      this.extractString(result, 'status') ||
      ''
    ).toUpperCase();

    if (normalized === 'ACCEPTED') return 'Accepted';
    if (normalized === 'TIMEOUT') return 'Timeout';
    if (normalized === 'REJECTED' || normalized === 'NOT_SUPPORTED') {
      return 'Rejected';
    }
    return 'Failed';
  }

  private extractOcpiResultError(
    result: Record<string, unknown>,
  ): string | null {
    const message =
      this.extractString(result, 'message') ||
      this.extractString(result, 'status_message') ||
      this.extractString(result, 'error_description');
    if (!message) return null;
    return message.trim().length > 0 ? message.trim() : null;
  }

  private async resolveChargePointForOcpiCommand(
    request: Record<string, unknown>,
  ): Promise<{ id: string; stationId: string } | null> {
    const evseCandidate =
      this.extractString(request, 'evse_uid') ||
      this.extractString(request, 'evseUid') ||
      this.extractString(request, 'charge_point_id') ||
      this.extractString(request, 'chargePointId');
    if (evseCandidate) {
      const byOcpp = await this.prisma.chargePoint.findUnique({
        where: { ocppId: evseCandidate },
        select: { id: true, stationId: true },
      });
      if (byOcpp) return byOcpp;

      const byId = await this.prisma.chargePoint.findUnique({
        where: { id: evseCandidate },
        select: { id: true, stationId: true },
      });
      if (byId) return byId;
    }

    const locationId =
      this.extractString(request, 'location_id') ||
      this.extractString(request, 'locationId');
    if (locationId) {
      const fromStation = await this.prisma.chargePoint.findFirst({
        where: { stationId: locationId },
        orderBy: { createdAt: 'asc' },
        select: { id: true, stationId: true },
      });
      if (fromStation) return fromStation;
    }

    const sessionId =
      this.extractString(request, 'session_id') ||
      this.extractString(request, 'sessionId');
    if (sessionId) {
      const session = await this.prisma.session.findFirst({
        where: {
          OR: [{ id: sessionId }, { ocppTxId: sessionId }],
        },
        select: { ocppId: true },
      });
      if (session?.ocppId) {
        const fromSession = await this.prisma.chargePoint.findUnique({
          where: { ocppId: session.ocppId },
          select: { id: true, stationId: true },
        });
        if (fromSession) return fromSession;
      }
    }

    return null;
  }

  private throwModuleNotSupported(moduleName: string): never {
    throw new HttpException(
      {
        code: 'MODULE_NOT_SUPPORTED',
        module: moduleName,
        message: `OCPI module ${moduleName} is not supported in core v1`,
      },
      HttpStatus.NOT_IMPLEMENTED,
    );
  }

  private defaultCountryCode(): string {
    return (this.config.get<string>('OCPI_COUNTRY_CODE') || 'US')
      .trim()
      .toUpperCase();
  }

  private defaultPartyId(): string {
    return (this.config.get<string>('OCPI_PARTY_ID') || 'EVZ')
      .trim()
      .toUpperCase();
  }

  private parseDate(value?: string): Date {
    if (!value) return new Date();
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return new Date();
    }
    return parsed;
  }

  private ensureObject(value: unknown): Record<string, unknown> {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    return {};
  }

  private extractString(
    source: Record<string, unknown> | undefined,
    key: string,
  ): string | null {
    if (!source) return null;
    const value = source[key];
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private extractNumber(
    source: Record<string, unknown> | undefined,
    key: string,
  ): number | null {
    if (!source) return null;
    const value = source[key];
    if (value === undefined || value === null || value === '') return null;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return null;
    const normalized = Math.floor(parsed);
    return normalized > 0 ? normalized : null;
  }
}
