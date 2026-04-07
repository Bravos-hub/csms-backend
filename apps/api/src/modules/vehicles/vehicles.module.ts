import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { VehiclesController } from './vehicles.controller';
import { VehiclesService } from './vehicles.service';
import { MediaStorageService } from '../../common/services/media-storage.service';

@Module({
  imports: [ConfigModule],
  controllers: [VehiclesController],
  providers: [VehiclesService, MediaStorageService],
  exports: [VehiclesService],
})
export class VehiclesModule {}
