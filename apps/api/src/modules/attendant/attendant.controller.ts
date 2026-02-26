import {
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
  @UseGuards(JwtAuthGuard)
  listBookings(
    @Req() req: Request & { user?: { sub?: string } },
    @Query() query: AttendantBookingsQueryDto,
  ) {
    return this.attendantService.listBookings(req.user?.sub || '', query);
  }

  @Get('bookings/:id')
  @UseGuards(JwtAuthGuard)
  getBookingById(
    @Req() req: Request & { user?: { sub?: string } },
    @Param('id') id: string,
  ) {
    return this.attendantService.getBookingById(req.user?.sub || '', id);
  }

  @Get('ports')
  @UseGuards(JwtAuthGuard)
  listPorts(
    @Req() req: Request & { user?: { sub?: string } },
    @Query() query: AttendantPortsQueryDto,
  ) {
    return this.attendantService.listPorts(req.user?.sub || '', query);
  }

  @Get('sessions/metrics')
  @UseGuards(JwtAuthGuard)
  getSessionMetrics(
    @Req() req: Request & { user?: { sub?: string } },
    @Query() query: AttendantSessionMetricsQueryDto,
  ) {
    return this.attendantService.getSessionMetrics(req.user?.sub || '', query);
  }

  @Get('mobile/assignment')
  @UseGuards(JwtAuthGuard)
  getMobileAssignment(@Req() req: Request & { user?: { sub?: string } }) {
    return this.attendantService.getMobileAssignment(req.user?.sub || '');
  }

  @Get('mobile/jobs')
  @UseGuards(JwtAuthGuard)
  listMobileJobs(@Req() req: Request & { user?: { sub?: string } }) {
    return this.attendantService.listMobileJobs(req.user?.sub || '');
  }

  @Get('transactions')
  @UseGuards(JwtAuthGuard)
  listTransactions(
    @Req() req: Request & { user?: { sub?: string } },
    @Query() query: AttendantTransactionsQueryDto,
  ) {
    return this.attendantService.listTransactions(req.user?.sub || '', query);
  }

  @Get('transactions/:id')
  @UseGuards(JwtAuthGuard)
  getTransactionById(
    @Req() req: Request & { user?: { sub?: string } },
    @Param('id') id: string,
  ) {
    return this.attendantService.getTransactionById(req.user?.sub || '', id);
  }

  @Get('notifications')
  @UseGuards(JwtAuthGuard)
  listNotifications(
    @Req() req: Request & { user?: { sub?: string } },
    @Query() query: AttendantNotificationsQueryDto,
  ) {
    return this.attendantService.listNotifications(req.user?.sub || '', query);
  }

  @Patch('notifications/:id/read')
  @HttpCode(204)
  @UseGuards(JwtAuthGuard)
  async markNotificationAsRead(
    @Req() req: Request & { user?: { sub?: string } },
    @Param('id') id: string,
  ) {
    await this.attendantService.markNotificationAsRead(req.user?.sub || '', id);
  }

  @Patch('notifications/read-all')
  @HttpCode(204)
  @UseGuards(JwtAuthGuard)
  async markAllNotificationsAsRead(
    @Req() req: Request & { user?: { sub?: string } },
  ) {
    await this.attendantService.markAllNotificationsAsRead(req.user?.sub || '');
  }

  @Post('sync/batch')
  @UseGuards(JwtAuthGuard)
  syncBatch(
    @Req() req: Request & { user?: { sub?: string } },
    @Body() dto: AttendantSyncBatchDto,
  ) {
    return this.attendantService.syncBatch(req.user?.sub || '', dto);
  }
}
