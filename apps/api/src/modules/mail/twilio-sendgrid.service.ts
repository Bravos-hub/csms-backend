import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

interface SendGridFromAddress {
  email: string;
  name?: string;
}

@Injectable()
export class TwilioSendgridService {
  private readonly logger = new Logger(TwilioSendgridService.name);

  constructor(private readonly configService: ConfigService) {}

  async sendEmail(params: {
    to: string;
    subject: string;
    html: string;
    from?: string;
  }): Promise<{ status: string }> {
    const apiKey = this.configService.get<string>(
      'TWILIO_SENDGRID_API_KEY',
      '',
    );
    if (!apiKey) {
      throw new Error('TWILIO_SENDGRID_API_KEY is not configured');
    }

    const defaultFrom = this.configService.get<string>(
      'TWILIO_SENDGRID_FROM',
      'noreply@evzone.com',
    );
    const parsedFrom = this.parseFrom(params.from || defaultFrom);

    const payload = {
      personalizations: [
        {
          to: [{ email: params.to }],
        },
      ],
      from: parsedFrom,
      subject: params.subject,
      content: [
        {
          type: 'text/html',
          value: params.html,
        },
      ],
    };

    const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(
        `SendGrid API error (${response.status}): ${errorBody.slice(0, 300)}`,
      );
    }

    this.logger.log(`SendGrid email sent to ${params.to}`);
    return { status: 'sent' };
  }

  private parseFrom(from: string): SendGridFromAddress {
    const trimmed = from.trim();
    const match = trimmed.match(/^"?([^"]+?)"?\s*<([^>]+)>$/);
    if (match) {
      const [, name, email] = match;
      return { name: name.trim(), email: email.trim() };
    }

    if (trimmed.includes('@')) {
      return { email: trimmed };
    }

    this.logger.warn(
      `Invalid sender format "${from}". Falling back to noreply@evzone.com`,
    );
    return { email: 'noreply@evzone.com' };
  }
}
