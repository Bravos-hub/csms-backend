import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BookingController } from './booking-service.controller';
import { BookingService } from './booking-service.service';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' })],
  controllers: [BookingController],
  providers: [BookingService],
})
export class BookingServiceModule {}
