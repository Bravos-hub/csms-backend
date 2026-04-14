import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
// import { TypeOrmModule } from '@nestjs/typeorm'; (Removed)
import { DatabaseModule } from '@app/database';
import { NotificationController } from './notification-service.controller';
import { NotificationService } from './notification-service.service';
import { TwilioService } from './twilio.service';
import { SubmailSmsService } from './submail-sms.service';
import { SubmailService } from '../../common/services/submail.service';
import { AfricasTalkingService } from './africas-talking.service';
import { MailModule } from '../mail/mail.module';
import { SseModule } from '../sse/sse.module';
// import { Notification } from './notifications/entities/notification.entity'; (Removed)

@Module({
  imports: [ConfigModule, DatabaseModule, MailModule, SseModule],
  controllers: [NotificationController],
  providers: [
    NotificationService,
    TwilioService,
    SubmailSmsService,
    SubmailService,
    AfricasTalkingService,
  ],
  exports: [NotificationService],
})
export class NotificationServiceModule {}
