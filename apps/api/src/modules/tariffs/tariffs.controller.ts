import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { PermissionsGuard } from '../auth/permissions.guard';
import { TariffsService } from './tariffs.service';

type TariffPayload = Record<string, unknown>;
type RequestUser = {
  sub?: string;
  userId?: string;
};
type RequestWithUser = Request & {
  user?: RequestUser;
};

@Controller('tariffs')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class TariffsController {
  constructor(private readonly tariffs: TariffsService) {}

  @Get()
  @RequirePermissions('tenant.tariffs.read')
  getAll(@Query('siteId') siteId?: string, @Query('status') status?: string) {
    return this.tariffs.listCalendars({ siteId, status });
  }

  @Get(':id')
  @RequirePermissions('tenant.tariffs.read')
  getById(@Param('id') id: string) {
    return this.tariffs.getCalendar(id);
  }

  @Post()
  @RequirePermissions('tenant.tariffs.write')
  create(@Body() payload: TariffPayload, @Req() request: RequestWithUser) {
    return this.tariffs.createCalendar(payload, this.resolveActorId(request));
  }

  @Patch(':id')
  @RequirePermissions('tenant.tariffs.write')
  update(
    @Param('id') id: string,
    @Body() payload: TariffPayload,
    @Req() request: RequestWithUser,
  ) {
    return this.tariffs.updateCalendar(
      id,
      payload,
      this.resolveActorId(request),
    );
  }

  @Post(':id/activate')
  @RequirePermissions('tenant.tariffs.write')
  activate(@Param('id') id: string, @Req() request: RequestWithUser) {
    return this.tariffs.activateCalendar(id, this.resolveActorId(request));
  }

  @Delete(':id')
  @RequirePermissions('tenant.tariffs.write')
  remove(@Param('id') id: string, @Req() request: RequestWithUser) {
    return this.tariffs.archiveCalendar(id, this.resolveActorId(request));
  }

  private resolveActorId(request: RequestWithUser): string | undefined {
    return request.user?.sub || request.user?.userId || undefined;
  }
}
