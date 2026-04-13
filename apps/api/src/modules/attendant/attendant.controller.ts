import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AttendantRoleGuard } from './attendant-role.guard';
import {
  AttendantAssignmentRequestDto,
  AttendantBookingsQueryDto,
  AttendantLoginDto,
  AttendantNotificationsQueryDto,
  AttendantPasswordResetConfirmDto,
  AttendantPasswordResetRequestDto,
  AttendantPasswordResetVerifyDto,
  AttendantPortsQueryDto,
  AttendantRefreshDto,
  AttendantSessionMetricsQueryDto,
  AttendantSyncBatchDto,
  AttendantTransactionsQueryDto,
} from './dto/attendant.dto';
import { AttendantService } from './attendant.service';

@Controller('attendant')
export class AttendantController {
  constructor(private readonly attendantService: AttendantService) {}

  private assertAuthenticatedUserId(
    req: Request & { user?: { sub?: string } },
  ) {
    const userId = req.user?.sub;
    if (!userId) {
      throw new BadRequestException('Authenticated user is required');
    }
    return userId;
  }

  @Post('auth/login')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  login(@Body() dto: AttendantLoginDto) {
    return this.attendantService.login(dto);
  }

  @Post('auth/refresh')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  refresh(@Body() dto: AttendantRefreshDto) {
    return this.attendantService.refresh(dto);
  }

  @Get('auth/session')
  @UseGuards(JwtAuthGuard, AttendantRoleGuard)
  getSession(@Req() req: Request & { user?: { sub?: string } }) {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ')
      ? authHeader.slice('Bearer '.length)
      : '';
    return this.attendantService.getSession(
      this.assertAuthenticatedUserId(req),
      token,
    );
  }

  @Post('auth/password/request')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  requestPasswordReset(@Body() dto: AttendantPasswordResetRequestDto) {
    return this.attendantService.requestPasswordReset(dto);
  }

  @Post('auth/password/verify')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  verifyPasswordResetCode(@Body() dto: AttendantPasswordResetVerifyDto) {
    return this.attendantService.verifyPasswordResetCode(dto);
  }

  @Post('auth/password/confirm')
  @HttpCode(204)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async confirmPasswordReset(@Body() dto: AttendantPasswordResetConfirmDto) {
    await this.attendantService.confirmPasswordReset(dto);
  }

  @Post('assignment-requests')
  @Throttle({ default: { limit: 8, ttl: 60_000 } })
  createAssignmentRequest(@Body() dto: AttendantAssignmentRequestDto) {
    return this.attendantService.createAssignmentRequest(dto);
  }

  @Get('bookings')
  @UseGuards(JwtAuthGuard, AttendantRoleGuard)
  listBookings(
    @Req() req: Request & { user?: { sub?: string } },
    @Query() query: AttendantBookingsQueryDto,
  ) {
    return this.attendantService.listBookings(
      this.assertAuthenticatedUserId(req),
      query,
    );
  }

  @Get('bookings/:id')
  @UseGuards(JwtAuthGuard, AttendantRoleGuard)
  getBookingById(
    @Req() req: Request & { user?: { sub?: string } },
    @Param('id') id: string,
  ) {
    return this.attendantService.getBookingById(
      this.assertAuthenticatedUserId(req),
      id,
    );
  }

  @Get('ports')
  @UseGuards(JwtAuthGuard, AttendantRoleGuard)
  listPorts(
    @Req() req: Request & { user?: { sub?: string } },
    @Query() query: AttendantPortsQueryDto,
  ) {
    return this.attendantService.listPorts(
      this.assertAuthenticatedUserId(req),
      query,
    );
  }

  @Get('sessions/metrics')
  @UseGuards(JwtAuthGuard, AttendantRoleGuard)
  getSessionMetrics(
    @Req() req: Request & { user?: { sub?: string } },
    @Query() query: AttendantSessionMetricsQueryDto,
  ) {
    return this.attendantService.getSessionMetrics(
      this.assertAuthenticatedUserId(req),
      query,
    );
  }

  @Get('mobile/assignment')
  @UseGuards(JwtAuthGuard, AttendantRoleGuard)
  getMobileAssignment(@Req() req: Request & { user?: { sub?: string } }) {
    return this.attendantService.getMobileAssignment(
      this.assertAuthenticatedUserId(req),
    );
  }

  @Get('mobile/jobs')
  @UseGuards(JwtAuthGuard, AttendantRoleGuard)
  listMobileJobs(@Req() req: Request & { user?: { sub?: string } }) {
    return this.attendantService.listMobileJobs(
      this.assertAuthenticatedUserId(req),
    );
  }

  @Get('transactions')
  @UseGuards(JwtAuthGuard, AttendantRoleGuard)
  listTransactions(
    @Req() req: Request & { user?: { sub?: string } },
    @Query() query: AttendantTransactionsQueryDto,
  ) {
    return this.attendantService.listTransactions(
      this.assertAuthenticatedUserId(req),
      query,
    );
  }

  @Get('transactions/:id')
  @UseGuards(JwtAuthGuard, AttendantRoleGuard)
  getTransactionById(
    @Req() req: Request & { user?: { sub?: string } },
    @Param('id') id: string,
  ) {
    return this.attendantService.getTransactionById(
      this.assertAuthenticatedUserId(req),
      id,
    );
  }

  @Get('notifications')
  @UseGuards(JwtAuthGuard, AttendantRoleGuard)
  listNotifications(
    @Req() req: Request & { user?: { sub?: string } },
    @Query() query: AttendantNotificationsQueryDto,
  ) {
    return this.attendantService.listNotifications(
      this.assertAuthenticatedUserId(req),
      query,
    );
  }

  @Patch('notifications/:id/read')
  @HttpCode(204)
  @UseGuards(JwtAuthGuard, AttendantRoleGuard)
  async markNotificationAsRead(
    @Req() req: Request & { user?: { sub?: string } },
    @Param('id') id: string,
  ) {
    await this.attendantService.markNotificationAsRead(
      this.assertAuthenticatedUserId(req),
      id,
    );
  }

  @Patch('notifications/read-all')
  @HttpCode(204)
  @UseGuards(JwtAuthGuard, AttendantRoleGuard)
  async markAllNotificationsAsRead(
    @Req() req: Request & { user?: { sub?: string } },
  ) {
    await this.attendantService.markAllNotificationsAsRead(
      this.assertAuthenticatedUserId(req),
    );
  }

  @Post('sync/batch')
  @UseGuards(JwtAuthGuard, AttendantRoleGuard)
  syncBatch(
    @Req() req: Request & { user?: { sub?: string } },
    @Body() dto: AttendantSyncBatchDto,
  ) {
    return this.attendantService.syncBatch(
      this.assertAuthenticatedUserId(req),
      dto,
    );
  }
}
