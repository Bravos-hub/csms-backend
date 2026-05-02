import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  UnauthorizedException,
  UseGuards,
  Query,
} from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import {
  ProviderWebhookPayloadDto,
  SendVehicleCommandDto,
  TelemetryStatusQueryDto,
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

  @Post('providers/:provider/webhooks')
  ingestWebhook(
    @Param('provider') provider: string,
    @Headers('x-telemetry-secret') secret: string | undefined,
    @Body() payload: ProviderWebhookPayloadDto,
  ) {
    if (!this.telemetry.validateProviderWebhookSecret(secret ?? null)) {
      throw new UnauthorizedException('Invalid telemetry webhook secret');
    }

    return this.telemetry.ingestProviderWebhook(provider, payload as Record<string, unknown>);
  }
}
