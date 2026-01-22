import { Injectable } from '@nestjs/common';
import { TwilioService } from './twilio.service';

@Injectable()
export class NotificationService {
  constructor(private readonly twilioService: TwilioService) { }

  getHello(): string {
    return 'Notification Service Operational';
  }

  async sendSms(to: string, message: string) {
    return this.twilioService.sendSms(to, message);
  }

  async sendNotification(userId: string, type: string, payload: any) {
    // Logic to resolve userId to phone number (e.g. from User Service)
    // For now, assume payload has phone
    if (type === 'SMS' && payload.phone) {
      return this.twilioService.sendSms(payload.phone, payload.message);
    }
    return { status: 'skipped', reason: 'Not SMS or no phone' };
  }
}
