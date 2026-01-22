import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
// import { TypeOrmModule } from '@nestjs/typeorm'; (Removed)
import { DatabaseModule } from '@app/database';
import { BillingController } from './billing-service.controller';
import { BillingService } from './billing-service.service';
import { PrismaService } from '../../prisma.service';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // DatabaseModule removed
    // TypeOrmModule removed
  ],
  controllers: [BillingController],
  providers: [BillingService, PrismaService],
})
export class BillingServiceModule { }
