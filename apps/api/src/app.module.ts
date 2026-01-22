import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './modules/auth/auth-service.module';
import { BillingServiceModule } from './modules/billing/billing-service.module';
import { BookingServiceModule } from './modules/booking/booking-service.module';
import { MaintenanceServiceModule } from './modules/maintenance/maintenance-service.module';
import { NotificationServiceModule } from './modules/notification/notification-service.module';
import { SessionServiceModule } from './modules/session/session-service.module';
import { StationServiceModule } from './modules/station/station-service.module';
import { SiteServiceModule } from './modules/site/site-service.module';
import { TenantServiceModule } from './modules/tenant/tenant-service.module';
import { AnalyticsServiceModule } from './modules/analytics/analytics-service.module';
import { ApplicationsModule } from './modules/applications/applications.module';
import { DocumentsModule } from './modules/documents/documents.module';
import { PrismaModule } from './prisma.module';
import { MailModule } from './modules/mail/mail.module';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    AuthModule,
    BillingServiceModule,
    BookingServiceModule,
    MaintenanceServiceModule,
    NotificationServiceModule,
    SessionServiceModule,
    StationServiceModule,
    SiteServiceModule,
    TenantServiceModule,
    AnalyticsServiceModule,
    ApplicationsModule,
    DocumentsModule,
    PrismaModule,
    MailModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule { }
