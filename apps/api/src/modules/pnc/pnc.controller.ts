import {
  BadRequestException,
  Body,
  Controller,
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
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { PncService } from './pnc.service';
import {
  CreatePncContractDto,
  IssuePncCertificateDto,
  PncListContractsQueryDto,
  RevokePncCertificateDto,
  UpdatePncContractDto,
} from './dto/pnc.dto';

type PncRequest = Request & {
  user?: {
    sub?: string;
  };
};

@Controller('pnc')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class PncController {
  constructor(private readonly pncService: PncService) {}

  @Get('overview')
  @RequirePermissions('charge_points.read')
  async getOverview(@Req() req: PncRequest): Promise<Record<string, unknown>> {
    return this.pncService.getOverview(this.requireActorId(req));
  }

  @Get('contracts')
  @RequirePermissions('charge_points.read')
  async listContracts(
    @Req() req: PncRequest,
    @Query() query: PncListContractsQueryDto,
  ): Promise<Record<string, unknown>[]> {
    return this.pncService.listContracts(this.requireActorId(req), query);
  }

  @Post('contracts')
  @RequirePermissions('charge_points.security.write')
  async createContract(
    @Req() req: PncRequest,
    @Body() dto: CreatePncContractDto,
  ): Promise<Record<string, unknown>> {
    return this.pncService.createContract(this.requireActorId(req), dto);
  }

  @Patch('contracts/:id')
  @RequirePermissions('charge_points.security.write')
  async updateContract(
    @Req() req: PncRequest,
    @Param('id') id: string,
    @Body() dto: UpdatePncContractDto,
  ): Promise<Record<string, unknown>> {
    return this.pncService.updateContract(this.requireActorId(req), id, dto);
  }

  @Post('contracts/:id/certificates')
  @RequirePermissions('charge_points.security.write')
  async issueCertificate(
    @Req() req: PncRequest,
    @Param('id') id: string,
    @Body() dto: IssuePncCertificateDto,
  ): Promise<Record<string, unknown>> {
    return this.pncService.issueCertificate(this.requireActorId(req), id, dto);
  }

  @Post('certificates/:id/revoke')
  @RequirePermissions('charge_points.security.write')
  async revokeCertificate(
    @Req() req: PncRequest,
    @Param('id') id: string,
    @Body() dto: RevokePncCertificateDto,
  ): Promise<Record<string, unknown>> {
    return this.pncService.revokeCertificate(this.requireActorId(req), id, dto);
  }

  @Get('certificates/:id/diagnostics')
  @RequirePermissions('charge_points.read')
  async getCertificateDiagnostics(
    @Req() req: PncRequest,
    @Param('id') id: string,
  ): Promise<Record<string, unknown>> {
    return this.pncService.getCertificateDiagnostics(
      this.requireActorId(req),
      id,
    );
  }

  private requireActorId(req: PncRequest): string {
    const actorId = req.user?.sub;
    if (!actorId) {
      throw new BadRequestException('Authenticated user is required');
    }
    return actorId;
  }
}
