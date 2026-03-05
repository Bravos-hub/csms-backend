import { Module, Global } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MailService } from './mail.service';
import { SubmailService } from '../../common/services/submail.service';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [MailService, SubmailService],
  exports: [MailService, SubmailService],
})
export class MailModule { }
