import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import {
  AutochargeEnrollmentDto,
  DriverWorkflowQueryDto,
  LoyaltyTransactionDto,
  OpenAdrEventDto,
  OpenAdrSettingsDto,
  RoamingPartnerProtocolsDto,
  SmartQueueQueryDto,
  TerminalCheckoutIntentDto,
  TerminalIntentReconcileDto,
  TerminalRegistrationDto,
  V2xProfileUpsertDto,
} from './dto/vendor-baseline.dto';
import { VendorBaselineService } from './vendor-baseline.service';

type VendorBaselineRequest = Request & {
  user?: {
    sub?: string;
  };
};

@Controller('vendor-baseline')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class VendorBaselineController {
  constructor(private readonly vendorBaseline: VendorBaselineService) {}

  @Get('overview')
  @RequirePermissions('platform.integrations.read')
  getOverview(@Req() req: VendorBaselineRequest) {
    return this.vendorBaseline.getOverview(this.resolveActorId(req));
  }

  @Put('openadr')
  @RequirePermissions('platform.integrations.read')
  upsertOpenAdrSettings(
    @Req() req: VendorBaselineRequest,
    @Body() body: OpenAdrSettingsDto,
  ) {
    return this.vendorBaseline.upsertOpenAdrSettings(
      this.resolveActorId(req),
      body,
    );
  }

  @Post('openadr/events')
  @RequirePermissions('platform.integrations.read')
  ingestOpenAdrEvent(
    @Req() req: VendorBaselineRequest,
    @Body() body: OpenAdrEventDto,
  ) {
    return this.vendorBaseline.ingestOpenAdrEvent(
      this.resolveActorId(req),
      body,
    );
  }

  @Patch('roaming/protocols/partners/:partnerId')
  @RequirePermissions('platform.integrations.read')
  updateRoamingPartnerProtocols(
    @Req() req: VendorBaselineRequest,
    @Param('partnerId') partnerId: string,
    @Body() body: RoamingPartnerProtocolsDto,
  ) {
    return this.vendorBaseline.updateRoamingPartnerProtocols(
      this.resolveActorId(req),
      partnerId,
      body,
    );
  }

  @Put('stations/:stationId/v2x')
  @RequirePermissions('platform.integrations.read')
  upsertStationV2xProfile(
    @Req() req: VendorBaselineRequest,
    @Param('stationId') stationId: string,
    @Body() body: V2xProfileUpsertDto,
  ) {
    return this.vendorBaseline.upsertStationV2xProfile(
      this.resolveActorId(req),
      stationId,
      body,
    );
  }

  @Post('autocharge/enrollments')
  @RequirePermissions('platform.integrations.read')
  enrollAutocharge(
    @Req() req: VendorBaselineRequest,
    @Body() body: AutochargeEnrollmentDto,
  ) {
    return this.vendorBaseline.enrollAutocharge(this.resolveActorId(req), body);
  }

  @Get('smart-queue')
  @RequirePermissions('platform.integrations.read')
  getSmartQueue(
    @Req() req: VendorBaselineRequest,
    @Query() query: SmartQueueQueryDto,
  ) {
    return this.vendorBaseline.getSmartQueue(this.resolveActorId(req), query);
  }

  @Post('payment-terminals/register')
  @RequirePermissions('platform.integrations.read')
  registerTerminal(
    @Req() req: VendorBaselineRequest,
    @Body() body: TerminalRegistrationDto,
  ) {
    return this.vendorBaseline.registerPaymentTerminal(
      this.resolveActorId(req),
      body,
    );
  }

  @Post('payment-terminals/checkout-intents')
  @RequirePermissions('platform.integrations.read')
  createTerminalCheckoutIntent(
    @Req() req: VendorBaselineRequest,
    @Body() body: TerminalCheckoutIntentDto,
  ) {
    return this.vendorBaseline.createTerminalCheckoutIntent(
      this.resolveActorId(req),
      body,
    );
  }

  @Post('payment-terminals/checkout-intents/:intentId/reconcile')
  @RequirePermissions('platform.integrations.read')
  reconcileTerminalCheckoutIntent(
    @Req() req: VendorBaselineRequest,
    @Param('intentId') intentId: string,
    @Body() body: TerminalIntentReconcileDto,
  ) {
    return this.vendorBaseline.reconcileTerminalCheckoutIntent(
      this.resolveActorId(req),
      intentId,
      body,
    );
  }

  @Post('loyalty/transactions')
  @RequirePermissions('platform.integrations.read')
  applyLoyaltyTransaction(
    @Req() req: VendorBaselineRequest,
    @Body() body: LoyaltyTransactionDto,
  ) {
    return this.vendorBaseline.applyLoyaltyTransaction(
      this.resolveActorId(req),
      body,
    );
  }

  @Get('driver-app/workflows/:driverId')
  @RequirePermissions('platform.integrations.read')
  getDriverWorkflow(
    @Req() req: VendorBaselineRequest,
    @Param('driverId') driverId: string,
    @Query() query: DriverWorkflowQueryDto,
  ) {
    return this.vendorBaseline.getDriverWorkflow(
      this.resolveActorId(req),
      driverId,
      query,
    );
  }

  private resolveActorId(req: VendorBaselineRequest): string {
    const actorId = req.user?.sub;
    if (typeof actorId === 'string' && actorId.trim().length > 0) {
      return actorId.trim();
    }

    const fallback = req.headers['x-user-id'];
    if (typeof fallback === 'string' && fallback.trim().length > 0) {
      return fallback.trim();
    }

    if (
      Array.isArray(fallback) &&
      typeof fallback[0] === 'string' &&
      fallback[0].trim().length > 0
    ) {
      return fallback[0].trim();
    }

    throw new BadRequestException('Authenticated user is required');
  }
}
