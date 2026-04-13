import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as Twilio from 'twilio';

@Injectable()
export class TwilioService {
  private readonly client: Twilio.Twilio | null;
  private readonly logger = new Logger(TwilioService.name);
  private readonly hasConfiguredCredentials: boolean;

  constructor(private readonly configService: ConfigService) {
    const accountSid = this.configService.get<string>('TWILIO_ACCOUNT_SID');
    const authToken = this.configService.get<string>('TWILIO_AUTH_TOKEN');

    if (accountSid && authToken) {
      this.client = new Twilio.Twilio(accountSid, authToken);
      this.hasConfiguredCredentials = true;
    } else {
      this.client = null;
      this.hasConfiguredCredentials = false;
      this.logger.warn(
        'Twilio credentials are not configured. SMS sending through Twilio is disabled.',
      );
    }
  }

  async sendSms(to: string, body: string) {
    const from = this.configService.get<string>('TWILIO_PHONE_NUMBER');

    if (!this.client || !this.hasConfiguredCredentials) {
      throw new ServiceUnavailableException(
        'Twilio SMS provider is not configured',
      );
    }

    if (!from) {
      throw new ServiceUnavailableException(
        'TWILIO_PHONE_NUMBER is not configured',
      );
    }

    try {
      return await this.client.messages.create({
        body,
        from,
        to,
      });
    } catch (error) {
      this.logger.error(`Failed to send SMS to ${to}`, error);
      throw error;
    }
  }
}
