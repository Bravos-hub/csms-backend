import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

@Injectable()
export class MailService {
    private transporter: nodemailer.Transporter;
    private readonly logger = new Logger(MailService.name);

    constructor(private readonly configService: ConfigService) {
        this.initializeTransporter();
    }

    private initializeTransporter() {
        const host = this.configService.get<string>('SMTP_HOST');
        const port = this.configService.get<number>('SMTP_PORT');
        const user = this.configService.get<string>('SMTP_USER');
        const pass = this.configService.get<string>('SMTP_PASS');

        if (!host || !user || !pass) {
            this.logger.warn('SMTP configuration missing. Email sending will be disabled.');
            return;
        }

        this.transporter = nodemailer.createTransport({
            host,
            port: port || 587,
            secure: false,
            auth: {
                user,
                pass,
            },
            requireTLS: true,
            tls: {
                minVersion: 'TLSv1.2',
                ciphers: 'HIGH:!aNULL:!MD5',
                rejectUnauthorized: true,
            }
        });

        this.verifyConnection();
    }

    private async verifyConnection() {
        if (!this.transporter) return;
        try {
            await this.transporter.verify();
            this.logger.log('SMTP connection established successfully');
        } catch (error) {
            this.logger.error('SMTP connection failed', error);
        }
    }

    async sendMail(to: string, subject: string, html: string) {
        if (!this.transporter) {
            this.logger.warn(`Email to ${to} skipped (no transporter)`);
            return;
        }

        const from = this.configService.get<string>('SMTP_FROM') || '"EV Zone" <noreply@evzone.com>';

        try {
            await this.transporter.sendMail({
                from,
                to,
                subject,
                html,
            });
            this.logger.log(`Email sent to ${to}`);
        } catch (error) {
            this.logger.error(`Failed to send email to ${to}`, error);
            throw error;
        }
    }

    async sendVerificationEmail(email: string, token: string) {
        const frontendUrl = this.configService.get<string>('FRONTEND_URL') || 'https://localhost:5173';
        const link = `${frontendUrl}/auth/verify-email?token=${token}`;

        const html = `
      <h1>Verify your email</h1>
      <p>Welcome to EV Zone! Please click the link below to verify your email address:</p>
      <a href="${link}" style="display: inline-block; padding: 10px 20px; background-color: #007bff; color: white; text-decoration: none; border-radius: 4px;">Verify Email</a>
      <p>This link will expire in 24 hours.</p>
      <p>If you did not request this verification, please ignore this email.</p>
    `;

        await this.sendMail(email, 'Verify your email', html);
    }

    async sendInvitationEmail(email: string) {
        const frontendUrl = this.configService.get<string>('FRONTEND_URL') || 'https://localhost:5173';
        const link = `${frontendUrl}/auth/register?email=${encodeURIComponent(email)}`;

        const html = `
      <h1>You've been invited!</h1>
      <p>You have been invited to join the EV Zone portal. Please click the link below to complete your registration:</p>
      <a href="${link}">Accept Invitation</a>
    `;

        await this.sendMail(email, 'Invitation to join EV Zone', html);
    }
}
