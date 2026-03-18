import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../modules/auth/jwt-auth.guard';
import {
  OcpiPartnerCreateRequestDto,
  OcpiPartnerListQueryDto,
  OcpiPartnerSyncRequestDto,
  OcpiPartnerUpdateRequestDto,
  OcpiRoamingListQueryDto,
  OcpiRoamingPublicationDto,
} from './dto/ocpi.dto';
import { OcpiService } from './ocpi.service';

@Controller('ocpi')
@UseGuards(JwtAuthGuard)
export class OcpiPartnersController {
  constructor(private readonly ocpiService: OcpiService) {}

  @Get('partners')
  async findAll(@Query() query: OcpiPartnerListQueryDto) {
    return this.ocpiService.findAllPartners(query);
  }

  @Post('partners')
  async create(@Body() payload: OcpiPartnerCreateRequestDto) {
    return this.ocpiService.createPartner(payload);
  }

  @Patch('partners/:id')
  async update(
    @Param('id') id: string,
    @Body() payload: OcpiPartnerUpdateRequestDto,
  ) {
    return this.ocpiService.updatePartner(id, payload);
  }

  @Post('partners/:id/suspend')
  async suspend(@Param('id') id: string) {
    return this.ocpiService.suspendPartner(id);
  }

  @Post('partners/:id/sync')
  async sync(
    @Param('id') id: string,
    @Body() payload: OcpiPartnerSyncRequestDto,
  ) {
    void payload;
    return this.ocpiService.syncPartner(id);
  }

  @Get('actions/roaming-sessions')
  async getRoamingSessions(@Query() query: OcpiRoamingListQueryDto) {
    return this.ocpiService.getRoamingSessions(query);
  }

  @Get('actions/roaming-sessions/:id')
  async getRoamingSession(@Param('id') id: string) {
    return this.ocpiService.getRoamingSessionById(id);
  }

  @Get('actions/roaming-cdrs')
  async getRoamingCdrs(@Query() query: OcpiRoamingListQueryDto) {
    return this.ocpiService.getRoamingCdrs(query);
  }

  @Get('actions/roaming-cdrs/:id')
  async getRoamingCdr(@Param('id') id: string) {
    return this.ocpiService.getRoamingCdrById(id);
  }

  @Get('actions/charge-points/:chargePointId/roaming-publication')
  async getRoamingPublication(@Param('chargePointId') chargePointId: string) {
    return this.ocpiService.getChargePointRoamingPublication(chargePointId);
  }

  @Put('actions/charge-points/:chargePointId/roaming-publication')
  async setRoamingPublication(
    @Param('chargePointId') chargePointId: string,
    @Body() payload: OcpiRoamingPublicationDto,
  ) {
    return this.ocpiService.setChargePointRoamingPublication(
      chargePointId,
      payload.published,
    );
  }
}
