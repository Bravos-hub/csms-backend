import { Module } from '@nestjs/common';
import { GeographyController } from './geography.controller';
import { GeographyService } from './geography.service';
import { PrismaService } from '../../prisma.service';

@Module({
    controllers: [GeographyController],
    providers: [GeographyService, PrismaService],
    exports: [GeographyService],
})
export class GeographyModule { }
