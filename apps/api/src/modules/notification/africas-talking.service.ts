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

    if (!response.ok) {
      throw new Error(
        `Africa's Talking API error (${response.status}): ${text.slice(0, 300)}`,
      );
    }

    this.logger.log(`Africa's Talking SMS sent to ${to}`);
    return parsed;
  }
}
