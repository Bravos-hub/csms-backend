import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import {
  CreateVehicleTelemetrySourceDto,
  ProviderWebhookPayloadDto,
  SendVehicleCommandDto,
  SmartcarIssueTokenDto,
  SmartcarRefreshTokenDto,
  SmartcarVehicleCommandDto,
  TelemetryStatusQueryDto,
  TelemetryStorageRawQueryDto,
  UpdateVehicleTelemetrySourceDto,
  VehicleCommandPayloadDto,
} from './telemetry.dto';
import { TelemetryService } from './telemetry.service';
import { VehicleCommandInput } from './telemetry.types';

type AuthenticatedUser = { sub: string };

@Controller('telemetry')
export class TelemetryController {
  constructor(private readonly telemetry: TelemetryService) {}

  private toCommandInput(dto: VehicleCommandPayloadDto): VehicleCommandInput {
    if (dto.type === 'SET_CHARGE_LIMIT') {
      if (typeof dto.limitPercent !== 'number') {
        throw new BadRequestException(
          'limitPercent is required for SET_CHARGE_LIMIT command',
        );
      }
      return {
        type: 'SET_CHARGE_LIMIT',
        limitPercent: dto.limitPercent,
      };
    }

    return { type: dto.type };
  }

  private resolveUserId(user: unknown): string {
    if (
      user &&
      typeof user === 'object' &&
      typeof (user as { sub?: unknown }).sub === 'string'
    ) {
      return (user as AuthenticatedUser).sub;
    }
    throw new UnauthorizedException('Invalid authenticated user payload');
  }

  @Get('vehicles/:vehicleId/status')
  @UseGuards(JwtAuthGuard)
  getStatus(
    @CurrentUser() user: unknown,
    @Param('vehicleId') vehicleId: string,
    @Query() query: TelemetryStatusQueryDto,
  ) {
    return this.telemetry.getVehicleStatus(this.resolveUserId(user), vehicleId, {
      provider: query.provider,
      providerId: query.providerId,
    });
  }

  @Post('vehicles/:vehicleId/commands')
  @UseGuards(JwtAuthGuard)
  sendCommand(
    @CurrentUser() user: unknown,
    @Param('vehicleId') vehicleId: string,
    @Body() dto: SendVehicleCommandDto,
  ) {
    return this.telemetry.sendVehicleCommand(this.resolveUserId(user), vehicleId, {
      command: this.toCommandInput(dto.command),
      provider: dto.provider,
      providerId: dto.providerId,
    });
  }

  @Get('vehicles/:vehicleId/commands/:commandId')
  @UseGuards(JwtAuthGuard)
  getCommandStatus(
    @CurrentUser() user: unknown,
    @Param('vehicleId') vehicleId: string,
    @Param('commandId') commandId: string,
  ) {
    return this.telemetry.getVehicleCommandStatus(
      this.resolveUserId(user),
      vehicleId,
      commandId,
    );
  }

  @Get('vehicles/:vehicleId/sources')
  @UseGuards(JwtAuthGuard)
  listSources(@CurrentUser() user: unknown, @Param('vehicleId') vehicleId: string) {
    return this.telemetry.listTelemetrySources(this.resolveUserId(user), vehicleId);
  }

  @Post('vehicles/:vehicleId/sources')
  @UseGuards(JwtAuthGuard)
  createSource(
    @CurrentUser() user: unknown,
    @Param('vehicleId') vehicleId: string,
    @Body() dto: CreateVehicleTelemetrySourceDto,
  ) {
    if (!dto.provider) {
      throw new BadRequestException('provider is required');
    }
    if (!dto.credentialRef) {
      throw new BadRequestException('credentialRef is required');
    }
    return this.telemetry.createTelemetrySource(this.resolveUserId(user), vehicleId, {
      provider: dto.provider,
      providerId: dto.providerId || null,
      credentialRef: dto.credentialRef,
      enabled: dto.enabled,
      capabilities: dto.capabilities,
      metadata: dto.metadata,
    });
  }

  @Patch('vehicles/:vehicleId/sources/:sourceId')
  @UseGuards(JwtAuthGuard)
  updateSource(
    @CurrentUser() user: unknown,
    @Param('vehicleId') vehicleId: string,
    @Param('sourceId') sourceId: string,
    @Body() dto: UpdateVehicleTelemetrySourceDto,
  ) {
    const updates: {
      providerId?: string | null;
      credentialRef?: string;
      enabled?: boolean;
      capabilities?: Array<'READ' | 'COMMANDS'>;
      metadata?: Record<string, unknown>;
    } = {};

    if (dto.providerId !== undefined) {
      updates.providerId = dto.providerId || null;
    }
    if (dto.credentialRef !== undefined) {
      updates.credentialRef = dto.credentialRef;
    }
    if (dto.enabled !== undefined) {
      updates.enabled = dto.enabled;
    }
    if (dto.capabilities !== undefined) {
      updates.capabilities = dto.capabilities;
    }
    if (dto.metadata !== undefined) {
      updates.metadata = dto.metadata;
    }

    return this.telemetry.updateTelemetrySource(
      this.resolveUserId(user),
      vehicleId,
      sourceId,
      updates,
    );
  }

  @Delete('vehicles/:vehicleId/sources/:sourceId')
  @UseGuards(JwtAuthGuard)
  removeSource(
    @CurrentUser() user: unknown,
    @Param('vehicleId') vehicleId: string,
    @Param('sourceId') sourceId: string,
  ) {
    return this.telemetry.removeTelemetrySource(this.resolveUserId(user), vehicleId, sourceId);
  }

  @Post('vehicles/:vehicleId/sources/:sourceId/enable')
  @UseGuards(JwtAuthGuard)
  enableSource(
    @CurrentUser() user: unknown,
    @Param('vehicleId') vehicleId: string,
    @Param('sourceId') sourceId: string,
  ) {
    return this.telemetry.setTelemetrySourceEnabled(
      this.resolveUserId(user),
      vehicleId,
      sourceId,
      true,
    );
  }

  @Post('vehicles/:vehicleId/sources/:sourceId/disable')
  @UseGuards(JwtAuthGuard)
  disableSource(
    @CurrentUser() user: unknown,
    @Param('vehicleId') vehicleId: string,
    @Param('sourceId') sourceId: string,
  ) {
    return this.telemetry.setTelemetrySourceEnabled(
      this.resolveUserId(user),
      vehicleId,
      sourceId,
      false,
    );
  }

  @Post('providers/smartcar/auth/token')
  @UseGuards(JwtAuthGuard)
  issueSmartcarToken(@CurrentUser() user: unknown, @Body() dto: SmartcarIssueTokenDto) {
    return this.telemetry.issueSmartcarToken(this.resolveUserId(user), {
      vehicleId: dto.vehicleId,
      providerId: dto.providerId || null,
      credentialRef: dto.credentialRef,
    });
  }

  @Post('providers/smartcar/auth/refresh')
  @UseGuards(JwtAuthGuard)
  refreshSmartcarToken(
    @CurrentUser() user: unknown,
    @Body() dto: SmartcarRefreshTokenDto,
  ) {
    return this.telemetry.refreshSmartcarToken(this.resolveUserId(user), {
      vehicleId: dto.vehicleId,
      credentialRef: dto.credentialRef,
      refreshToken: dto.refreshToken,
    });
  }

  @Get('providers/smartcar/vehicles/:vehicleId/status')
  @UseGuards(JwtAuthGuard)
  getSmartcarStatus(
    @CurrentUser() user: unknown,
    @Param('vehicleId') vehicleId: string,
    @Query('providerId') providerId?: string,
  ) {
    return this.telemetry.getSmartcarVehicleStatus(
      this.resolveUserId(user),
      vehicleId,
      providerId || null,
    );
  }

  @Post('providers/smartcar/vehicles/:vehicleId/commands')
  @UseGuards(JwtAuthGuard)
  sendSmartcarCommand(
    @CurrentUser() user: unknown,
    @Param('vehicleId') vehicleId: string,
    @Body() dto: SmartcarVehicleCommandDto,
  ) {
    return this.telemetry.sendSmartcarVehicleCommand(this.resolveUserId(user), vehicleId, {
      providerId: dto.providerId || null,
      command: this.toCommandInput(dto.command),
    });
  }

  @Get('providers/smartcar/vehicles/:vehicleId/commands/:commandId')
  @UseGuards(JwtAuthGuard)
  getSmartcarCommandStatus(
    @CurrentUser() user: unknown,
    @Param('vehicleId') vehicleId: string,
    @Param('commandId') commandId: string,
  ) {
    return this.telemetry.getSmartcarVehicleCommandStatus(
      this.resolveUserId(user),
      vehicleId,
      commandId,
    );
  }

  @Post('providers/smartcar/webhooks')
  ingestSmartcarWebhook(
    @Headers('sc-signature') signature: string | undefined,
    @Headers('x-smartcar-signature') legacySignature: string | undefined,
    @Body() payload: Record<string, unknown>,
    @Req() request: { rawBody?: string },
  ) {
    if (!request.rawBody) {
      throw new BadRequestException(
        'Smartcar webhook raw body is required for signature verification',
      );
    }

    return this.telemetry.ingestSmartcarWebhook(
      payload,
      request.rawBody,
      signature ?? legacySignature ?? null,
    );
  }

  @Post('providers/:provider/webhooks')
  ingestWebhook(
    @Param('provider') provider: string,
    @Headers('x-telemetry-secret') secret: string | undefined,
    @Body() payload: ProviderWebhookPayloadDto,
  ) {
    if (!this.telemetry.validateProviderWebhookSecret(secret ?? null)) {
      throw new UnauthorizedException('Invalid telemetry webhook secret');
    }

    return this.telemetry.ingestProviderWebhook(
      provider,
      payload as Record<string, unknown>,
    );
  }

  @Get('storage/raw')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN, UserRole.EVZONE_ADMIN)
  getRawSnapshots(@Query() query: TelemetryStorageRawQueryDto) {
    return this.telemetry.listRawSnapshots(query.limit ?? 100);
  }

  @Get('storage/alerts')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN, UserRole.EVZONE_ADMIN)
  getStorageAlerts(@Query() query: TelemetryStorageRawQueryDto) {
    return this.telemetry.listTelemetryAlerts(query.limit ?? 100);
  }

  @Post('storage/maintenance/retention')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN, UserRole.EVZONE_ADMIN)
  runStorageRetentionMaintenance() {
    return this.telemetry.runTelemetryRetentionMaintenance();
  }
}
