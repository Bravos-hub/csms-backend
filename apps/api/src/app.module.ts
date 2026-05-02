import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma.module';

// Existing Modules (Restored)
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
import { MailModule } from './modules/mail/mail.module';
import { EnergyManagementModule } from './modules/energy-management/energy-management.module';
import { EnergyOptimizationModule } from './modules/energy-optimization/energy-optimization.module';

// Imported Modules from cpms-api
import { CommandsModule } from './modules/commands/commands.module';
import { DispatchesModule } from './modules/dispatches/dispatches.module';
import { HealthModule } from './modules/health/health.module';
import { IncidentsModule } from './modules/incidents/incidents.module';
import { NoticesModule } from './modules/notices/notices.module';
import { OrganizationsModule } from './modules/organizations/organizations.module';
import { PaymentMethodsModule } from './modules/payment-methods/payment-methods.module';
import { ProvidersModule } from './modules/providers/providers.module';
import { TariffsModule } from './modules/tariffs/tariffs.module';
import { UsersModule } from './modules/users/users.module'; // Copied module
import { WalletModule } from './modules/wallet/wallet.module';
import { WebhooksModule } from './modules/webhooks/webhooks.module';
import { WithdrawalsModule } from './modules/withdrawals/withdrawals.module';
import { SseModule } from './modules/sse/sse.module'; // Imported SSE
import { OcpiInternalModule } from './modules/ocpi-internal/ocpi-internal.module';
import { SubscriptionPlansModule } from './modules/subscription-plans/subscription-plans.module';
import { AuditLogsModule } from './modules/audit-logs/audit-logs.module';
import { ApprovalsModule } from './modules/approvals/approvals.module';
import { FeatureFlagsModule } from './feature-flags/feature-flags.module';
import { TechniciansModule } from './technicians/technicians.module';
import { OcpiModule } from './modules/ocpi/ocpi.module';
import { GeographyModule } from './modules/geography/geography.module';
import { MarketplaceContactsModule } from './modules/marketplace/marketplace-contacts.module';
import { ObservabilityModule } from './common/observability/observability.module';
import { TenantRoutingModule } from './common/tenant/tenant-routing.module';
import { AttendantModule } from './modules/attendant/attendant.module';
import { VehiclesModule } from './modules/vehicles/vehicles.module';
import { BmsModule } from './modules/bms/bms.module';
import { TenantRbacModule } from './modules/tenant-rbac/tenant-rbac.module';
import { TenantProvisioningModule } from './modules/tenant-provisioning/tenant-provisioning.module';
import { PlatformModule } from './modules/platform/platform.module';
import { FleetModule } from './modules/fleet/fleet.module';
import { PncModule } from './modules/pnc/pnc.module';
import { EnterpriseIamModule } from './modules/enterprise-iam/enterprise-iam.module';
import { DeveloperPlatformModule } from './modules/developer-platform/developer-platform.module';
import { VendorBaselineModule } from './modules/vendor-baseline/vendor-baseline.module';
import { TenantBrandingModule } from './modules/tenant-branding/tenant-branding.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { MqttModule } from '@app/mqtt';
import { BatterySwapMqttAdapterModule } from './modules/adapters/battery-swap-mqtt-adapter/battery-swap-mqtt-adapter.module';
import { LegacyEvseMqttAdapterModule } from './modules/adapters/legacy-evse-mqtt-adapter/legacy-evse-mqtt-adapter.module';
import { MqttEdgeAdapterModule } from './modules/adapters/mqtt-edge-adapter/mqtt-edge-adapter.module';
import { TelemetryModule } from './modules/telemetry/telemetry.module';
import { DiagnosticsModule } from './modules/diagnostics/diagnostics.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' }),
    ThrottlerModule.forRoot([
      {
        ttl: parseInt(process.env.API_RATE_LIMIT_TTL_MS || '60000', 10),
        limit: parseInt(process.env.API_RATE_LIMIT_LIMIT || '120', 10),
      },
    ]),
    ObservabilityModule,
    TenantRoutingModule,
    PrismaModule,
    TenantProvisioningModule,

    // Existing
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
    MailModule,
    EnergyManagementModule,
    EnergyOptimizationModule,

    // Imported
    CommandsModule,
    DispatchesModule,
    HealthModule,
    IncidentsModule,
    NoticesModule,
    OrganizationsModule,
    PaymentMethodsModule,
    ProvidersModule,
    TariffsModule,
    UsersModule,
    WalletModule,
    WebhooksModule,
    WithdrawalsModule,
    SseModule,
    OcpiInternalModule,
    SubscriptionPlansModule,
    AuditLogsModule,
    ApprovalsModule,
    FeatureFlagsModule,
    TechniciansModule,
    OcpiModule,
    GeographyModule,
    MarketplaceContactsModule,
    AttendantModule,
    VehiclesModule,
    BmsModule,
    TenantRbacModule,
    PlatformModule,
    FleetModule,
    PncModule,
    EnterpriseIamModule,
    DeveloperPlatformModule,
    VendorBaselineModule,
    TenantBrandingModule,
    PaymentsModule,
    MqttModule.forRoot(),
    BatterySwapMqttAdapterModule,
    LegacyEvseMqttAdapterModule,
    MqttEdgeAdapterModule,
    TelemetryModule,
    DiagnosticsModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
