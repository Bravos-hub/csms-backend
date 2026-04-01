import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface SubmailEmailParams {
  to: string;
  from?: string;
  subject: string;
  html?: string;
  text?: string;
}

export interface SubmailSmsParams {
  to: string;
  content: string;
}

export interface SubmailSmsTemplateParams {
  to: string;
  project: string; // Template ID
  vars: Record<string, string>; // JSON object for variables
}

type SubmailApiResponse = {
  status?: string;
  msg?: string;
  [key: string]: unknown;
};

@Injectable()
export class SubmailService {
  private readonly logger = new Logger(SubmailService.name);

  private readonly mailAppId: string;
  private readonly mailAppKey: string;
  private readonly defaultFrom: string;

  private readonly smsAppId: string;
  private readonly smsAppKey: string;

  constructor(private readonly configService: ConfigService) {
    this.mailAppId = this.configService.get<string>('SUBMAIL_MAIL_APPID', '');
    this.mailAppKey = this.configService.get<string>('SUBMAIL_MAIL_APPKEY', '');
    this.defaultFrom = this.configService.get<string>(
      'SUBMAIL_MAIL_FROM',
      '"EV Zone" <noreply@evzone.com>',
    );

    this.smsAppId = this.configService.get<string>('SUBMAIL_SMS_APPID', '');
    this.smsAppKey = this.configService.get<string>('SUBMAIL_SMS_APPKEY', '');
  }

  private toApiResponse(raw: unknown): SubmailApiResponse {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return {};
    }
    return raw as SubmailApiResponse;
  }

  private assertSuccess(data: SubmailApiResponse): void {
    if (data.status === 'success') {
      return;
    }
    const message = typeof data.msg === 'string' ? data.msg : 'unknown error';
    throw new Error(`Submail API Error: ${message}`);
  }

  async sendEmail(
    params: SubmailEmailParams,
  ): Promise<SubmailApiResponse | void> {
    if (!this.mailAppId || !this.mailAppKey) {
      this.logger.warn('Submail Mail credentials missing. Email skipped.');
      return;
    }

    const payload: Record<string, unknown> = {
      appid: this.mailAppId,
      signature: this.mailAppKey,
      to: params.to,
      from: params.from || this.defaultFrom,
      subject: params.subject,
    };

    if (params.html) payload.html = params.html;
    if (params.text) payload.text = params.text;

    try {
      const response = await fetch('https://api-v4.mysubmail.com/mail/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const data = this.toApiResponse(await response.json());
      this.assertSuccess(data);
      this.logger.log(`Submail email sent successfully to ${params.to}`);
      return data;
    } catch (error) {
      this.logger.error(`Failed to send Submail email to ${params.to}`, error);
      throw error;
    }
  }

  async sendSms(params: SubmailSmsParams): Promise<SubmailApiResponse | void> {
    if (!this.smsAppId || !this.smsAppKey) {
      this.logger.warn('Submail SMS credentials missing. SMS skipped.');
      return;
    }

    const payload = {
      appid: this.smsAppId,
      signature: this.smsAppKey,
      to: params.to,
      content: params.content,
    };

    try {
      const response = await fetch('https://api-v4.mysubmail.com/sms/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const data = this.toApiResponse(await response.json());
      this.assertSuccess(data);
      this.logger.log(`Submail SMS sent successfully to ${params.to}`);
      return data;
    } catch (error) {
      this.logger.error(`Failed to send Submail SMS to ${params.to}`, error);
      throw error;
    }
  }

  async sendSmsByTemplate(
    params: SubmailSmsTemplateParams,
  ): Promise<SubmailApiResponse | void> {
    if (!this.smsAppId || !this.smsAppKey) {
      this.logger.warn('Submail SMS credentials missing. SMS skipped.');
      return;
    }

    const payload = {
      appid: this.smsAppId,
      signature: this.smsAppKey,
      to: params.to,
      project: params.project,
      vars: JSON.stringify(params.vars),
    };

    try {
      const response = await fetch('https://api-v4.mysubmail.com/sms/xsend', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const data = this.toApiResponse(await response.json());
      this.assertSuccess(data);
      this.logger.log(
        `Submail SMS (template) sent successfully to ${params.to}`,
      );
      return data;
    } catch (error) {
      this.logger.error(
        `Failed to send Submail SMS (template) to ${params.to}`,
        error,
      );
      throw error;
    }
  }
}
