import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
// import { TypeOrmModule } from '@nestjs/typeorm'; (Removed)
import { DatabaseModule } from '@app/database';
import { NotificationController } from './notification-service.controller';
import { NotificationService } from './notification-service.service';
import { TwilioService } from './twilio.service';
// import { Notification } from './notifications/entities/notification.entity'; (Removed)

@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
  ],
  controllers: [NotificationController],
  providers: [NotificationService, TwilioService],
  exports: [NotificationService],
})
export class NotificationServiceModule { }
