import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
// import { TypeOrmModule } from '@nestjs/typeorm'; (Removed)
import { DatabaseModule } from '@app/database';
import { BookingController } from './booking-service.controller';
import { BookingService } from './booking-service.service';
import { PrismaService } from '../../prisma.service';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // DatabaseModule removed
    // TypeOrmModule removed
  ],
  controllers: [BookingController],
  providers: [BookingService, PrismaService],
})
export class BookingServiceModule { }
