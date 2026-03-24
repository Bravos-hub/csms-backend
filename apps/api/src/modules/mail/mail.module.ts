import { Module, Global } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MailService } from './mail.service';
import { SubmailService } from '../../common/services/submail.service';
import { TwilioSendgridService } from './twilio-sendgrid.service';
import { MessagingRoutingService } from '../../common/services/messaging-routing.service';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    MailService,
    SubmailService,
    TwilioSendgridService,
    MessagingRoutingService,
  ],
  exports: [
    MailService,
    SubmailService,
    TwilioSendgridService,
    MessagingRoutingService,
  ],
})
export class MailModule {}
