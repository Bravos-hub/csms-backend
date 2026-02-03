import { Module } from '@nestjs/common';
import { DatabaseModule } from '@app/database';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { AuthController, UsersController } from './auth-service.controller';
import { AuthService } from './auth-service.service';
import { AdminApprovalService } from './admin-approval.service';
import { AdminApprovalController } from './admin-approval.controller';
import { TokenCleanupService } from './token-cleanup.service';
import { MetricsService } from '../../common/services/metrics.service';
import { OcpiTokenSyncService } from '../../common/services/ocpi-token-sync.service';
import { NotificationServiceModule } from '../notification/notification-service.module';
import { PrismaService } from '../../prisma.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { ServiceAuthGuard } from './service-auth.guard';
import { ServiceScopeGuard } from './service-scope.guard';

@Module({
  imports: [
    ConfigModule,
    ScheduleModule.forRoot(), // Enable scheduled tasks
    NotificationServiceModule,
  ],
  controllers: [AuthController, UsersController, AdminApprovalController],
  providers: [
    AuthService,
    TokenCleanupService, // Add cleanup service
    MetricsService, // Add metrics service
    OcpiTokenSyncService,
    PrismaService,
    JwtAuthGuard,
    ServiceAuthGuard,
    ServiceScopeGuard,
    AdminApprovalService,
  ],
  exports: [JwtAuthGuard, ServiceAuthGuard, ServiceScopeGuard, MetricsService],
})
export class AuthModule { }
