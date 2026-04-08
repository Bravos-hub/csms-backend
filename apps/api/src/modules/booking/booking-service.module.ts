import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BookingController } from './booking-service.controller';
import { BookingService } from './booking-service.service';
import { CommandsModule } from '../commands/commands.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' }),
    CommandsModule,
  ],
  controllers: [BookingController],
  providers: [BookingService],
})
export class BookingServiceModule {}
