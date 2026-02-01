
import { Module } from '@nestjs/common';
import { OcpiPartnersController } from './ocpi-partners.controller';
import { OcpiService } from './ocpi.service';
import { PrismaService } from '../../prisma.service';

@Module({
    controllers: [OcpiPartnersController],
    providers: [OcpiService, PrismaService],
})
export class OcpiModule { }
