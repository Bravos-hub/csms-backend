import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
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
import { ApplicationsService } from './applications.service';
import {
  AcceptEnterpriseQuoteDto,
  ActivateApplicationDto,
  ConfirmTierSelectionDto,
  CreateApplicationDto,
  CreateApplicationPaymentIntentDto,
  ListApplicationsQueryDto,
  ReviewApplicationDto,
  SyncApplicationPaymentDto,
  UpdateOwnApplicationDto,
} from './dto/application.dto';

type ApplicationsRequest = Request & {
  user?: {
    sub?: string;
    role?: string;
    canonicalRole?: string;
    accessProfile?: {
      canonicalRole?: string;
    };
  };
};

@Controller('applications')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ApplicationsController {
  constructor(private readonly applicationsService: ApplicationsService) {}

  private assertUserId(req: ApplicationsRequest): string {
    const userId = req.user?.sub;
    if (!userId) {
      throw new BadRequestException('Authenticated user is required');
    }

    return userId;
  }

  private isSuperAdmin(req: ApplicationsRequest): boolean {
    const canonicalRole =
      req.user?.canonicalRole || req.user?.accessProfile?.canonicalRole;

    return (
      canonicalRole === 'PLATFORM_SUPER_ADMIN' ||
      req.user?.role === 'SUPER_ADMIN'
    );
  }

  private assertSuperAdmin(req: ApplicationsRequest): string {
    const actorId = this.assertUserId(req);
    if (!this.isSuperAdmin(req)) {
      throw new ForbiddenException(
        'Only platform super admins can perform this action',
      );
    }

    return actorId;
  }

  @Get('me')
  listMine(@Req() req: ApplicationsRequest) {
    const applicantId = this.assertUserId(req);
    return this.applicationsService.listMine(applicantId);
  }

  @Get('onboarding/tiers')
  listApplicantTierPricing() {
    return this.applicationsService.listPublishedTierPricingForApplicants();
  }

  @Get('onboarding/canonical-roles')
  @RequirePermissions('platform.tenants.read')
  listTenantScopedCanonicalRoles(@Req() req: ApplicationsRequest) {
    this.assertSuperAdmin(req);
    return this.applicationsService.listTenantScopedCanonicalRoles();
  }

  @Get()
  @RequirePermissions('platform.tenants.read')
  listForAdmin(
    @Req() req: ApplicationsRequest,
    @Query() filters: ListApplicationsQueryDto,
  ) {
    this.assertSuperAdmin(req);
    return this.applicationsService.listForAdmin(filters);
  }

  @Get(':id')
  async getOne(@Param('id') id: string, @Req() req: ApplicationsRequest) {
    const userId = this.assertUserId(req);
    if (this.isSuperAdmin(req)) {
      return this.applicationsService.getOneForAdmin(id);
    }
    return this.applicationsService.getOneForApplicant(id, userId);
  }

  @Post()
  create(@Body() dto: CreateApplicationDto, @Req() req: ApplicationsRequest) {
    const applicantId = this.assertUserId(req);
    return this.applicationsService.create(applicantId, dto);
  }

  @Patch(':id')
  updateOwn(
    @Param('id') id: string,
    @Body() dto: UpdateOwnApplicationDto,
    @Req() req: ApplicationsRequest,
  ) {
    const applicantId = this.assertUserId(req);
    return this.applicationsService.updateOwn(id, applicantId, dto);
  }

  @Patch(':id/review')
  @RequirePermissions('platform.tenants.write')
  review(
    @Param('id') id: string,
    @Body() dto: ReviewApplicationDto,
    @Req() req: ApplicationsRequest,
  ) {
    const reviewerId = this.assertSuperAdmin(req);
    return this.applicationsService.review(id, reviewerId, dto);
  }

  @Post(':id/tier-confirmation')
  confirmTier(
    @Param('id') id: string,
    @Body() dto: ConfirmTierSelectionDto,
    @Req() req: ApplicationsRequest,
  ) {
    const applicantId = this.assertUserId(req);
    return this.applicationsService.confirmTier(id, applicantId, dto);
  }

  @Post(':id/payment-intent')
  createPaymentIntent(
    @Param('id') id: string,
    @Body() dto: CreateApplicationPaymentIntentDto,
    @Req() req: ApplicationsRequest,
  ) {
    const applicantId = this.assertUserId(req);
    return this.applicationsService.createPaymentIntent(id, applicantId, dto);
  }

  async resolvePaymentSyncActor(
    id: string,
    req: ApplicationsRequest,
  ): Promise<string> {
    const requesterId = this.assertUserId(req);
    if (!this.isSuperAdmin(req)) {
      return requesterId;
    }

    const application = await this.applicationsService.getOneForAdmin(id);
    return application.applicantId;
  }

  @Patch(':id/payment-intent/sync')
  async syncPaymentIntent(
    @Param('id') id: string,
    @Body() dto: SyncApplicationPaymentDto,
    @Req() req: ApplicationsRequest,
  ) {
    const applicantId = await this.resolvePaymentSyncActor(id, req);
    return this.applicationsService.syncPaymentStatus(id, applicantId, dto);
  }

  @Post(':id/quote/accept')
  acceptEnterpriseQuote(
    @Param('id') id: string,
    @Body() dto: AcceptEnterpriseQuoteDto,
    @Req() req: ApplicationsRequest,
  ) {
    const applicantId = this.assertUserId(req);
    return this.applicationsService.acceptEnterpriseQuote(id, applicantId, dto);
  }

  @Post(':id/activate')
  @RequirePermissions('platform.tenants.write')
  activate(
    @Param('id') id: string,
    @Body() dto: ActivateApplicationDto,
    @Req() req: ApplicationsRequest,
  ) {
    const reviewerId = this.assertSuperAdmin(req);
    return this.applicationsService.activate(id, reviewerId, dto);
  }
}
