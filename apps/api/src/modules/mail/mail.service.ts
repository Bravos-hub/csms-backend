import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SubmailService } from '../../common/services/submail.service';
import {
  DeliveryContext,
  MessagingRoutingService,
} from '../../common/services/messaging-routing.service';
import { TwilioSendgridService } from './twilio-sendgrid.service';

type EmailProvider = 'twilio_sendgrid' | 'submail';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly submailService: SubmailService,
    private readonly twilioSendgridService: TwilioSendgridService,
    private readonly routingService: MessagingRoutingService,
  ) {}

  private getSenderAddress() {
    return (
      this.configService.get<string>('TWILIO_SENDGRID_FROM') ||
      this.configService.get<string>('SUBMAIL_MAIL_FROM') ||
      '"EV Zone" <noreply@evzone.com>'
    );
  }

  async sendMail(
    to: string,
    subject: string,
    html: string,
    context?: DeliveryContext,
  ) {
    const from = this.getSenderAddress();
    const route = await this.routingService.resolveEmailRoute({ to, context });

    try {
      return await this.sendEmailWithProvider(route.primary, {
        to,
        subject,
        html,
        from,
      });
    } catch (primaryError) {
      if (!route.fallback) {
        this.logger.error(
          `Primary email provider ${route.primary} failed for ${to}`,
          primaryError,
        );
        throw primaryError;
      }

      this.logger.warn(
        `Primary email provider ${route.primary} failed for ${to}. Falling back to ${route.fallback}.`,
      );
      return this.sendEmailWithProvider(route.fallback, {
        to,
        subject,
        html,
        from,
      });
    }
  }

  private async sendEmailWithProvider(
    provider: EmailProvider,
    params: { to: string; subject: string; html: string; from: string },
  ) {
    if (provider === 'submail') {
      return this.submailService.sendEmail(params);
    }
    return this.twilioSendgridService.sendEmail(params);
  }

  async sendVerificationEmail(
    email: string,
    token: string,
    frontendUrl?: string,
    context?: DeliveryContext,
  ) {
    const baseUrl =
      frontendUrl ||
      this.configService.get<string>('FRONTEND_URL') ||
      'https://localhost:5173';
    const link = `${baseUrl}/auth/verify-email?token=${token}`;

    const html = `
      <h1>Verify your email</h1>
      <p>Welcome to EV Zone! Please click the link below to verify your email address:</p>
      <a href="${link}" style="display: inline-block; padding: 10px 20px; background-color: #007bff; color: white; text-decoration: none; border-radius: 4px;">Verify Email</a>
      <p>This link will expire in 24 hours.</p>
      <p>If you did not request this verification, please ignore this email.</p>
    `;

    await this.sendMail(email, 'Verify your email', html, context);
  }

  async sendInvitationEmail(
    email: string,
    role: string | undefined,
    organization: string = 'EV Zone',
    frontendUrl?: string,
    inviteToken?: string,
    tempPassword?: string,
    context?: DeliveryContext,
  ) {
    const baseUrl =
      frontendUrl ||
      this.configService.get<string>('FRONTEND_URL') ||
      'https://localhost:5173';
    const tokenQuery = inviteToken
      ? `?token=${encodeURIComponent(inviteToken)}`
      : '';
    const link = `${baseUrl}/auth/invitation/accept${tokenQuery}`;
    const tempPasswordSection = tempPassword
      ? `
        <div style="background-color: #fff8ed; border: 1px solid #f59e0b; padding: 14px; border-radius: 6px; margin: 20px 0;">
          <p style="margin: 0; font-size: 14px; color: #8a5a00;">Temporary password</p>
          <p style="margin: 8px 0 0 0; font-size: 20px; font-weight: bold; letter-spacing: 0.04em; color: #1f2937;">${tempPassword}</p>
          <p style="margin: 8px 0 0 0; font-size: 12px; color: #6b7280;">
            Sign in with this temporary password, then change it immediately.
          </p>
        </div>
      `
      : '';

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
        <div style="text-align: center; margin-bottom: 30px;">
          <h1 style="color: #1a1a1a; margin-top: 0;">You've been invited!</h1>
        </div>
        
        <p style="font-size: 16px; color: #444; line-height: 1.6;">
          Hello,
        </p>
        
        <p style="font-size: 16px; color: #444; line-height: 1.6;">
          You have been invited to join <strong>${organization}</strong> on the EV Zone portal.
        </p>

        ${
          role
            ? `<div style="background-color: #f8f9fa; padding: 15px; border-radius: 6px; margin: 20px 0;">
          <p style="margin: 0; font-size: 14px; color: #666;">Position / Role:</p>
          <p style="margin: 5px 0 0 0; font-size: 18px; font-weight: bold; color: #333;">${role}</p>
        </div>`
            : ''
        }

        <p style="font-size: 16px; color: #444; line-height: 1.6;">
          Please click the button below to accept your invitation and continue to sign in:
        </p>

        ${tempPasswordSection}

        <div style="text-align: center; margin: 30px 0;">
          <a href="${link}" style="display: inline-block; padding: 14px 30px; background-color: #f59e0b; color: white; text-decoration: none; border-radius: 6px; font-weight: bold; font-size: 16px;">Accept Invitation</a>
        </div>

        <p style="font-size: 14px; color: #888; margin-top: 40px; border-top: 1px solid #eeeeee; padding-top: 20px; text-align: center;">
          Best regards,<br>
          <strong>The EV Zone Team</strong>
        </p>
        
        <p style="font-size: 12px; color: #aaa; text-align: center; margin-top: 10px;">
          If the button above doesn't work, copy and paste this link into your browser:<br>
          <a href="${link}" style="color: #007bff;">${link}</a>
        </p>
      </div>
    `;

    await this.sendMail(
      email,
      `Invitation to join ${organization} on EV Zone`,
      html,
      context,
    );
  }

  async sendApplicationReceivedEmail(
    email: string,
    name: string,
    context?: DeliveryContext,
  ) {
    const html = `
      <h1>Application Received!</h1>
      <p>Dear ${name},</p>
      <p>Thank you for registering with EV Zone. Your application is currently under review by our team.</p>
      <p>You will receive an email notification once your application has been reviewed.</p>
      <p>If you have any questions, please contact us at support@evzone.com</p>
      <p>Best regards,<br>EV Zone Team</p>
    `;

    await this.sendMail(email, 'Application Received - EV Zone', html, context);
  }

  async sendApplicationApprovedEmail(
    email: string,
    name: string,
    frontendUrl?: string,
    context?: DeliveryContext,
  ) {
    const baseUrl =
      frontendUrl ||
      this.configService.get<string>('FRONTEND_URL') ||
      'https://localhost:5173';
    const loginLink = `${baseUrl}/auth/login`;

    const html = `
      <h1>Application Approved! 🎉</h1>
      <p>Dear ${name},</p>
      <p>Congratulations! Your registration application has been approved by our team.</p>
      <p>You can now log in to your EV Zone dashboard and start managing your EV charging infrastructure.</p>
      <a href="${loginLink}" style="display: inline-block; padding: 10px 20px; background-color: #28a745; color: white; text-decoration: none; border-radius: 4px; margin: 10px 0;">Login to Dashboard</a>
      <p>If you have any questions or need assistance, please don't hesitate to contact us.</p>
      <p>Welcome aboard!<br>EV Zone Team</p>
    `;

    await this.sendMail(email, 'Application Approved - EV Zone', html, context);
  }

  async sendApplicationRejectedEmail(
    email: string,
    name: string,
    reason: string,
    context?: DeliveryContext,
  ) {
    const html = `
      <h1>Application Update</h1>
      <p>Dear ${name},</p>
      <p>Thank you for your interest in EV Zone. After careful review, we regret to inform you that your application could not be approved at this time.</p>
      <p><strong>Reason:</strong> ${reason}</p>
      <p>If you believe this decision was made in error or would like to reapply with additional information, please contact us at support@evzone.com</p>
      <p>Best regards,<br>EV Zone Team</p>
    `;

    await this.sendMail(email, 'Application Update - EV Zone', html, context);
  }
}
