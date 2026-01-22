import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
// import { TypeOrmModule } from '@nestjs/typeorm'; (Removed)
import { DatabaseModule } from '@app/database';
import { MaintenanceController, WebhookController } from './maintenance-service.controller';
import { MaintenanceService } from './maintenance-service.service';
import { PrismaService } from '../../prisma.service';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // DatabaseModule removed
    // TypeOrmModule removed
  ],
  controllers: [MaintenanceController, WebhookController],
  providers: [MaintenanceService, PrismaService],
})
export class MaintenanceServiceModule { }
