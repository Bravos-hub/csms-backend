import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import {
  MaintenanceController,
  WebhookController,
} from './maintenance-service.controller';
import { MaintenanceService } from './maintenance-service.service';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' })],
  controllers: [MaintenanceController, WebhookController],
  providers: [MaintenanceService],
})
export class MaintenanceServiceModule {}
