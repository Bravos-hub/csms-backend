import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class AfricasTalkingService {
  private readonly logger = new Logger(AfricasTalkingService.name);

  constructor(private readonly configService: ConfigService) {}

  async sendSms(to: string, message: string): Promise<Record<string, unknown>> {
    const username = this.configService.get<string>(
      'AFRICASTALKING_USERNAME',
      '',
    );
    const apiKey = this.configService.get<string>('AFRICASTALKING_API_KEY', '');
    const from = this.configService.get<string>('AFRICASTALKING_FROM', '');

    if (!username || !apiKey) {
      throw new Error(
        'AFRICASTALKING_USERNAME or AFRICASTALKING_API_KEY is not configured',
      );
    }

    const body = new URLSearchParams();
    body.append('username', username);
    body.append('to', to);
    body.append('message', message);
    if (from) {
      body.append('from', from);
    }

    const response = await fetch(
      'https://api.africastalking.com/version1/messaging',
      {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          apiKey,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
      },
    );

    const text = await response.text();
    let parsed: Record<string, unknown>;
    try {
      const payload: unknown = text ? JSON.parse(text) : {};
      parsed =
        payload && typeof payload === 'object' && !Array.isArray(payload)
          ? (payload as Record<string, unknown>)
          : { raw: text };
    } catch {
      parsed = { raw: text };
    }

    this.logger.debug(`Africa's Talking API Response Body: ${text}`);
    this.logger.debug(
      `Africa's Talking API Parsed Object: ${JSON.stringify(parsed)}`,
    );

    const recipients = (parsed.SMSMessageData as any)?.Recipients;
    const messageStatus = (parsed.SMSMessageData as any)?.Message;

    if (!recipients || !Array.isArray(recipients) || recipients.length === 0) {
      const errorMsg =
        messageStatus || (parsed as any).raw || 'Unknown delivery failure';
      this.logger.error(`Africa's Talking delivery FAILED: ${errorMsg}`);
      throw new Error(`Africa's Talking delivery FAILED: ${errorMsg}`);
    }

    const firstRecipient = recipients[0];
    if (firstRecipient.status !== 'Success' && firstRecipient.status !== 'Buffered') {
      this.logger.error(`Africa's Talking delivery FAILED for ${to}: ${firstRecipient.status}`);
      throw new Error(`Africa's Talking delivery FAILED for ${to}: ${firstRecipient.status}`);
    }

    this.logger.log(`Africa's Talking SMS sent to ${to}`);
    this.logger.warn(`FALLBACK: SMS message content sent to ${to}: ${message}`);
    return parsed;
  }
}
