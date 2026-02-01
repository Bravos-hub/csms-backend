import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
// import { TypeOrmModule } from '@nestjs/typeorm'; (Removed)
import { DatabaseModule } from '@app/database';
import { BillingController } from './billing-service.controller';
import { FinanceController } from './finance.controller';
import { BillingService } from './billing-service.service';
import { PrismaService } from '../../prisma.service';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // DatabaseModule removed
    // TypeOrmModule removed
  ],
  controllers: [BillingController, FinanceController],
  providers: [BillingService, PrismaService],
  exports: [BillingService],
})
export class BillingServiceModule { }
