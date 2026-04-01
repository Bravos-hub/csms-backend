import { Module } from '@nestjs/common';
import { GeographyController } from './geography.controller';
import { TilesController } from './tiles.controller';
import { GeographyService } from './geography.service';

@Module({
  controllers: [GeographyController, TilesController],
  providers: [GeographyService],
  exports: [GeographyService],
})
export class GeographyModule {}
