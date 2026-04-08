import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma.module';
import { EnergyOptimizationController } from './energy-optimization.controller';
import { EnergyOptimizationService } from './energy-optimization.service';

@Module({
  imports: [PrismaModule],
  controllers: [EnergyOptimizationController],
  providers: [EnergyOptimizationService],
  exports: [EnergyOptimizationService],
})
export class EnergyOptimizationModule {}
