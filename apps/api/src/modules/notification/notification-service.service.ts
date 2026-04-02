import { Injectable, Logger } from '@nestjs/common';
import { TwilioService } from './twilio.service';
import { SubmailSmsService } from './submail-sms.service';
import {
  DeliveryContext,
  MessagingRoutingService,
} from '../../common/services/messaging-routing.service';
import { AfricasTalkingService } from './africas-talking.service';

type SmsProvider = 'submail' | 'africas_talking' | 'twilio';

type NotificationKind =
  | 'system'
  | 'alert'
  | 'info'
  | 'warning'
  | 'notice'
  | 'message'
  | 'payment'
  | 'application';

type NoticeChannel = 'in-app' | 'email' | 'sms';

type SendNotificationPayload = {
  phone?: string;
  message?: string;
  userId?: string;
  zoneId?: string;
  country?: string;
  region?: string;
};

export interface NotificationItemDto {
  id: string;
  kind: NotificationKind;
  title: string;
  message: string;
  source: string;
  read: boolean;
  createdAt: string;
  channels?: NoticeChannel[];
  status?: string;
  targetPath?: string;
  metadata?: Record<string, string>;
}

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    private readonly twilioService: TwilioService,
    private readonly submailSmsService: SubmailSmsService,
    private readonly africasTalkingService: AfricasTalkingService,
    private readonly routingService: MessagingRoutingService,
  ) {}

  getNotifications(): NotificationItemDto[] {
    return [];
  }

  async sendSms(
    to: string,
    message: string,
    context?: DeliveryContext,
  ): Promise<unknown> {
    const route = await this.routingService.resolveSmsRoute({ to, context });
    try {
      return await this.sendSmsWithProvider(route.primary, to, message);
    } catch (primaryError) {
      if (!route.fallback) {
        this.logger.error(
          `Primary SMS provider ${route.primary} failed for ${to}`,
          primaryError,
        );
        throw primaryError;
      }

      this.logger.warn(
        `Primary SMS provider ${route.primary} failed for ${to}. Falling back to ${route.fallback}.`,
      );
      return this.sendSmsWithProvider(route.fallback, to, message);
    }
  }

  async sendNotification(
    userId: string,
    type: string,
    payload: SendNotificationPayload,
  ): Promise<unknown> {
    // Logic to resolve userId to phone number (e.g. from User Service)
    // For now, assume payload has phone
    const phone = payload.phone;
    const message = payload.message;
    if (type === 'SMS') {
      if (
        typeof phone !== 'string' ||
        phone.length === 0 ||
        typeof message !== 'string' ||
        message.length === 0
      ) {
        return { status: 'skipped', reason: 'Not SMS or no phone' };
      }

      const context: DeliveryContext = {
        userId: payload.userId || userId,
        zoneId: payload.zoneId,
        country: payload.country,
        region: payload.region,
      };
      return this.sendSms(phone, message, context);
    }
    return { status: 'skipped', reason: 'Not SMS or no phone' };
  }

  private async sendSmsWithProvider(
    provider: SmsProvider,
    to: string,
    message: string,
  ): Promise<unknown> {
    if (provider === 'submail') {
      return this.submailSmsService.sendSms(to, message) as Promise<unknown>;
    }
    if (provider === 'africas_talking') {
      return this.africasTalkingService.sendSms(
        to,
        message,
      ) as Promise<unknown>;
    }
    return this.twilioService.sendSms(to, message) as Promise<unknown>;
  }
}
