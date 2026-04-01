import { Module } from '@nestjs/common';
import { OcpiPartnersController } from './ocpi-partners.controller';
import { OcpiService } from './ocpi.service';

@Module({
  controllers: [OcpiPartnersController],
  providers: [OcpiService],
})
export class OcpiModule {}
