import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as Twilio from 'twilio';

@Injectable()
export class TwilioService {
    private client: Twilio.Twilio;
    private readonly logger = new Logger(TwilioService.name);

    constructor(private readonly configService: ConfigService) {
        const accountSid = this.configService.get<string>('TWILIO_ACCOUNT_SID');
        const authToken = this.configService.get<string>('TWILIO_AUTH_TOKEN');

        if (accountSid && authToken) {
            this.client = new Twilio.Twilio(accountSid, authToken);
        } else {
            this.logger.warn('Twilio credentials not found. SMS features will be mocked.');
        }
    }

    async sendSms(to: string, body: string) {
        const from = this.configService.get<string>('TWILIO_PHONE_NUMBER');

        if (!this.client) {
            this.logger.log(`[MOCK SMS] To: ${to}, Body: ${body}`);
            return { sid: 'mock-sid', status: 'sent(mock)' };
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
