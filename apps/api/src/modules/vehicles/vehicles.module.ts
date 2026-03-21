import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { VehiclesController } from './vehicles.controller';
import { VehiclesService } from './vehicles.service';
import { PrismaService } from '../../prisma.service';
import { MediaStorageService } from '../../common/services/media-storage.service';

@Module({
  imports: [ConfigModule],
  controllers: [VehiclesController],
  providers: [VehiclesService, PrismaService, MediaStorageService],
  exports: [VehiclesService],
})
export class VehiclesModule {}
