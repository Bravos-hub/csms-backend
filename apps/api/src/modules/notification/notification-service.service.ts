import { Injectable, Logger } from '@nestjs/common';
import { TwilioService } from './twilio.service';
import { SubmailSmsService } from './submail-sms.service';
import {
  DeliveryContext,
  MessagingRoutingService,
} from '../../common/services/messaging-routing.service';
import { AfricasTalkingService } from './africas-talking.service';
import { MailService } from '../mail/mail.service';
import { EventStreamService } from '../sse/sse.service';
import { PrismaService } from '../../prisma.service';

type SmsProvider = 'submail' | 'africas_talking' | 'twilio';
type ChannelStatus = 'sent' | 'skipped' | 'failed';

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
  title?: string;
  userId?: string;
  zoneId?: string;
  country?: string;
  region?: string;
};

type NotificationDispatchResult = {
  push: ChannelStatus;
  sms: ChannelStatus;
  email: ChannelStatus;
};

type DispatchToUserInput = {
  userId: string;
  type: string;
  title: string;
  message: string;
  smsMessage?: string;
  emailSubject?: string;
  emailHtml?: string;
  metadata?: Record<string, unknown>;
};

type PaymentStatus = 'SETTLED' | 'FAILED' | 'CANCELED' | 'EXPIRED';

type UserDeliveryProfile = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  zoneId: string | null;
  country: string | null;
  region: string | null;
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
    private readonly mailService: MailService,
    private readonly eventStream: EventStreamService,
    private readonly prisma: PrismaService,
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

    if (type === 'PUSH') {
      const title = payload.title || 'Notification';
      return this.sendPush(payload.userId || userId, title, message || '', {
        type: 'manual.push',
        metadata: {
          zoneId: payload.zoneId || null,
          country: payload.country || null,
          region: payload.region || null,
        },
      });
    }

    return { status: 'skipped', reason: 'Not SMS or no phone' };
  }

  sendPush(
    userId: string,
    title: string,
    message: string,
    options?: {
      type?: string;
      metadata?: Record<string, unknown>;
    },
  ): {
    status: 'queued';
    userId: string;
    type: string;
    createdAt: string;
  } {
    const createdAt = new Date().toISOString();
    const type = options?.type || 'notification';
    this.eventStream.emit('push.notification', {
      userId,
      type,
      title,
      message,
      createdAt,
      metadata: options?.metadata || {},
    });

    return {
      status: 'queued',
      userId,
      type,
      createdAt,
    };
  }

  async notifyOnboardingCompleted(input: {
    userId: string;
    organizationName?: string | null;
    tierCode?: string | null;
  }): Promise<NotificationDispatchResult> {
    const organizationName = input.organizationName || 'EV Zone';
    const tierSuffix = input.tierCode ? ` (${input.tierCode})` : '';
    const title = 'Welcome onboard';
    const message = `Your onboarding for ${organizationName}${tierSuffix} is complete.`;

    return this.dispatchToUser({
      userId: input.userId,
      type: 'onboarding.completed',
      title,
      message,
      smsMessage: `EVzone: Welcome onboard! Your onboarding for ${organizationName}${tierSuffix} is complete.`,
      emailSubject: `Welcome to ${organizationName}`,
      emailHtml: `
        <h2>Welcome onboard</h2>
        <p>Your onboarding for <strong>${organizationName}${tierSuffix}</strong> is complete.</p>
        <p>You can now access your EVzone workspace and start operations.</p>
      `,
      metadata: {
        organizationName,
        tierCode: input.tierCode || null,
      },
    });
  }

  async notifySessionEnded(input: {
    userId: string;
    energyWh: number;
    amount: number;
    currency?: string | null;
    sessionType?: 'charging' | 'swapping' | 'session';
  }): Promise<NotificationDispatchResult> {
    const currency = input.currency || 'USD';
    const sessionType = input.sessionType || 'session';
    const formattedAmount = Number.isFinite(input.amount)
      ? input.amount.toFixed(2)
      : '0.00';
    const title = 'Session ended';
    const message = `Your ${sessionType} session ended. Energy: ${input.energyWh}Wh. Cost: ${currency} ${formattedAmount}.`;

    return this.dispatchToUser({
      userId: input.userId,
      type: 'session.ended',
      title,
      message,
      smsMessage: `EVzone: ${sessionType} session ended. Energy: ${input.energyWh}Wh. Cost: ${currency} ${formattedAmount}.`,
      emailSubject: `${sessionType[0].toUpperCase()}${sessionType.slice(1)} session summary`,
      emailHtml: `
        <h2>${sessionType[0].toUpperCase()}${sessionType.slice(1)} session ended</h2>
        <p>Energy delivered: <strong>${input.energyWh} Wh</strong></p>
        <p>Total cost: <strong>${currency} ${formattedAmount}</strong></p>
      `,
      metadata: {
        sessionType,
        energyWh: input.energyWh,
        amount: input.amount,
        currency,
      },
    });
  }

  async notifyInvitationAccepted(input: {
    invitedUserId?: string | null;
    inviterUserId?: string | null;
    inviteeEmail?: string | null;
    organizationName?: string | null;
    role?: string | null;
  }): Promise<{
    invitedUser?: NotificationDispatchResult;
    inviterUser?: NotificationDispatchResult;
  }> {
    const organizationName = input.organizationName || 'EV Zone';
    const roleSuffix = input.role ? ` as ${input.role}` : '';

    const result: {
      invitedUser?: NotificationDispatchResult;
      inviterUser?: NotificationDispatchResult;
    } = {};

    if (input.invitedUserId) {
      result.invitedUser = await this.dispatchToUser({
        userId: input.invitedUserId,
        type: 'invite.accepted.recipient',
        title: 'Invitation accepted',
        message: `You joined ${organizationName}${roleSuffix}.`,
        smsMessage: `EVzone: Invitation accepted. You joined ${organizationName}${roleSuffix}.`,
        emailSubject: `You joined ${organizationName}`,
        emailHtml: `
          <h2>Invitation accepted</h2>
          <p>You have successfully joined <strong>${organizationName}</strong>${roleSuffix}.</p>
        `,
        metadata: {
          organizationName,
          role: input.role || null,
        },
      });
    } else if (input.inviteeEmail) {
      await this.trySendEmail(
        input.inviteeEmail,
        `You joined ${organizationName}`,
        `
          <h2>Invitation accepted</h2>
          <p>You have successfully joined <strong>${organizationName}</strong>${roleSuffix}.</p>
        `,
      );
    }

    if (input.inviterUserId) {
      result.inviterUser = await this.dispatchToUser({
        userId: input.inviterUserId,
        type: 'invite.accepted.inviter',
        title: 'Invite accepted',
        message: `A team invitation for ${organizationName} was accepted.`,
        smsMessage: `EVzone: Your invitation for ${organizationName} was accepted.`,
        emailSubject: `Invitation accepted for ${organizationName}`,
        emailHtml: `
          <h2>Invitation accepted</h2>
          <p>A team invitation for <strong>${organizationName}</strong> has been accepted.</p>
        `,
        metadata: {
          organizationName,
        },
      });
    }

    return result;
  }

  async notifyPaymentRequestSent(input: {
    userId: string;
    paymentIntentId: string;
    amount: number;
    currency: string;
  }): Promise<NotificationDispatchResult> {
    const formattedAmount = Number.isFinite(input.amount)
      ? input.amount.toFixed(2)
      : '0.00';

    return this.dispatchToUser({
      userId: input.userId,
      type: 'payment.requested',
      title: 'Payment request sent',
      message: `A payment request of ${input.currency} ${formattedAmount} has been created.`,
      smsMessage: `EVzone: Payment request sent. Amount ${input.currency} ${formattedAmount}.`,
      emailSubject: 'Payment request created',
      emailHtml: `
        <h2>Payment request sent</h2>
        <p>Your payment request has been created.</p>
        <p>Amount: <strong>${input.currency} ${formattedAmount}</strong></p>
        <p>Reference: <strong>${input.paymentIntentId}</strong></p>
      `,
      metadata: {
        paymentIntentId: input.paymentIntentId,
        amount: input.amount,
        currency: input.currency,
      },
    });
  }

  async notifyPaymentStatusChanged(input: {
    userId: string;
    paymentIntentId: string;
    amount: number;
    currency: string;
    status: PaymentStatus;
  }): Promise<NotificationDispatchResult> {
    const formattedAmount = Number.isFinite(input.amount)
      ? input.amount.toFixed(2)
      : '0.00';
    const isSuccess = input.status === 'SETTLED';
    const title = isSuccess ? 'Payment successful' : 'Payment failed';
    const message = isSuccess
      ? `Your payment of ${input.currency} ${formattedAmount} was successful.`
      : `Your payment of ${input.currency} ${formattedAmount} was not successful (${input.status}).`;

    return this.dispatchToUser({
      userId: input.userId,
      type: isSuccess ? 'payment.succeeded' : 'payment.failed',
      title,
      message,
      smsMessage: `EVzone: ${message}`,
      emailSubject: title,
      emailHtml: `
        <h2>${title}</h2>
        <p>${message}</p>
        <p>Reference: <strong>${input.paymentIntentId}</strong></p>
      `,
      metadata: {
        paymentIntentId: input.paymentIntentId,
        amount: input.amount,
        currency: input.currency,
        status: input.status,
      },
    });
  }

  async sendReportNotification(input: {
    userId: string;
    reportName: string;
    reportPeriod?: string | null;
    reportUrl?: string | null;
  }): Promise<NotificationDispatchResult> {
    const periodSuffix = input.reportPeriod ? ` (${input.reportPeriod})` : '';
    const reportUrlLine = input.reportUrl
      ? `<p><a href="${input.reportUrl}">Open report</a></p>`
      : '';

    return this.dispatchToUser({
      userId: input.userId,
      type: 'report.ready',
      title: 'Report ready',
      message: `${input.reportName}${periodSuffix} is ready.`,
      smsMessage: `EVzone: ${input.reportName}${periodSuffix} report is ready.`,
      emailSubject: `${input.reportName} report ready`,
      emailHtml: `
        <h2>Report ready</h2>
        <p>Your report <strong>${input.reportName}${periodSuffix}</strong> is ready.</p>
        ${reportUrlLine}
      `,
      metadata: {
        reportName: input.reportName,
        reportPeriod: input.reportPeriod || null,
        reportUrl: input.reportUrl || null,
      },
    });
  }

  async sendVerificationNotification(input: {
    userId: string;
    code: string;
    expiresInMinutes: number;
  }): Promise<NotificationDispatchResult> {
    return this.dispatchToUser({
      userId: input.userId,
      type: 'verification.code',
      title: 'Verification required',
      message: `Your verification code is ${input.code}. It expires in ${input.expiresInMinutes} minutes.`,
      smsMessage: `EVzone verification code: ${input.code}. Expires in ${input.expiresInMinutes} minutes.`,
      emailSubject: 'Verification code',
      emailHtml: `
        <h2>Verification code</h2>
        <p>Your code is <strong>${input.code}</strong>.</p>
        <p>This code expires in ${input.expiresInMinutes} minutes.</p>
      `,
      metadata: {
        expiresInMinutes: input.expiresInMinutes,
      },
    });
  }

  private async dispatchToUser(
    input: DispatchToUserInput,
  ): Promise<NotificationDispatchResult> {
    const profile = await this.findDeliveryProfile(input.userId);
    if (!profile) {
      this.logger.warn(
        `Notification target user was not found for event ${input.type}`,
      );
      return {
        push: 'skipped',
        sms: 'skipped',
        email: 'skipped',
      };
    }

    const result: NotificationDispatchResult = {
      push: 'skipped',
      sms: 'skipped',
      email: 'skipped',
    };

    try {
      this.sendPush(profile.id, input.title, input.message, {
        type: input.type,
        metadata: input.metadata,
      });
      result.push = 'sent';
    } catch (error) {
      result.push = 'failed';
      this.logger.warn(
        `Push notification failed for user ${profile.id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    if (input.smsMessage && profile.phone) {
      const sms = await this.trySendSms(
        profile.phone,
        input.smsMessage,
        this.toDeliveryContext(profile),
      );
      result.sms = sms ? 'sent' : 'failed';
    }

    if (input.emailSubject && input.emailHtml && profile.email) {
      const mail = await this.trySendEmail(
        profile.email,
        input.emailSubject,
        input.emailHtml,
        this.toDeliveryContext(profile),
      );
      result.email = mail ? 'sent' : 'failed';
    }

    return result;
  }

  private async findDeliveryProfile(
    userId: string,
  ): Promise<UserDeliveryProfile | null> {
    if (!userId.trim()) {
      return null;
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        zoneId: true,
        country: true,
        region: true,
      },
    });

    if (!user) {
      return null;
    }

    return {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      zoneId: user.zoneId,
      country: user.country,
      region: user.region,
    };
  }

  private toDeliveryContext(profile: UserDeliveryProfile): DeliveryContext {
    return {
      userId: profile.id,
      zoneId: profile.zoneId,
      country: profile.country,
      region: profile.region,
    };
  }

  private async trySendSms(
    to: string,
    message: string,
    context?: DeliveryContext,
  ): Promise<boolean> {
    try {
      await this.sendSms(to, message, context);
      return true;
    } catch (error) {
      this.logger.warn(
        `SMS notification failed for ${to}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return false;
    }
  }

  private async trySendEmail(
    to: string,
    subject: string,
    html: string,
    context?: DeliveryContext,
  ): Promise<boolean> {
    try {
      await this.mailService.sendMail(to, subject, html, context);
      return true;
    } catch (error) {
      this.logger.warn(
        `Email notification failed for ${to}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return false;
    }
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
