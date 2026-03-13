import { Injectable } from '@nestjs/common';
import { TwilioService } from './twilio.service';
import { SubmailSmsService } from './submail-sms.service';
import { ConfigService } from '@nestjs/config';
import { resolvePlatformProfile } from '../../common/platform/platform-profile';

@Injectable()
export class NotificationService {
  private readonly smsProvider: 'twilio' | 'submail';

  constructor(
    private readonly twilioService: TwilioService,
    private readonly submailSmsService: SubmailSmsService,
    private readonly configService: ConfigService,
  ) {
    this.smsProvider =
      this.configService.get<'twilio' | 'submail'>('SMS_PROVIDER') ??
      resolvePlatformProfile(process.env).smsProvider;
  }

  getHello(): string {
    return 'Notification Service Operational';
  }

  async sendSms(to: string, message: string) {
    if (this.smsProvider === 'submail') {
      return this.submailSmsService.sendSms(to, message);
    }
    return this.twilioService.sendSms(to, message);
  }

  async sendNotification(userId: string, type: string, payload: any) {
    // Logic to resolve userId to phone number (e.g. from User Service)
    // For now, assume payload has phone
    if (type === 'SMS' && payload.phone) {
      if (this.smsProvider === 'submail') {
        return this.submailSmsService.sendSms(payload.phone, payload.message);
      }
      return this.twilioService.sendSms(payload.phone, payload.message);
    }
    return { status: 'skipped', reason: 'Not SMS or no phone' };
  }
}
