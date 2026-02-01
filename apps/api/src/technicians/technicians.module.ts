import { Module } from '@nestjs/common';
import { TechniciansController } from './technicians.controller';
import { TechniciansService } from './technicians.service';
import { PrismaModule } from '../prisma.module';

@Module({
    imports: [PrismaModule],
    controllers: [TechniciansController],
    providers: [TechniciansService],
    exports: [TechniciansService],
})
export class TechniciansModule { }
