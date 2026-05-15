import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { BatteryProvidersController } from './battery-providers.controller';
import { BatteryProviderAdminController } from './battery-provider-admin.controller';
import { BatteryProviderAccessService } from './battery-provider-access.service';
import { BatteryProviderGuard } from './battery-provider.guard';
import { BatteryProviderDashboardService } from './battery-provider-dashboard.service';
import { BatteryProviderPacksService } from './battery-provider-packs.service';
import { BatteryProviderCabinetsService } from './battery-provider-cabinets.service';
import { BatteryProviderSwapsService } from './battery-provider-swaps.service';
import { BatteryProviderAlertsService } from './battery-provider-alerts.service';
import { BatteryProviderMaintenanceService } from './battery-provider-maintenance.service';
import { BatteryProviderSlaService } from './battery-provider-sla.service';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [BatteryProvidersController, BatteryProviderAdminController],
  providers: [
    BatteryProviderAccessService,
    BatteryProviderGuard,
    BatteryProviderDashboardService,
    BatteryProviderPacksService,
    BatteryProviderCabinetsService,
    BatteryProviderSwapsService,
    BatteryProviderAlertsService,
    BatteryProviderMaintenanceService,
    BatteryProviderSlaService,
  ],
  exports: [BatteryProviderAccessService],
})
export class BatteryProvidersModule {}
