import { MailService } from './mail.service';

describe('MailService', () => {
  const configService = {
    get: jest.fn((key: string, fallback?: string) => {
      const values: Record<string, string> = {
        TWILIO_SENDGRID_FROM: 'EVzone <noreply@evzonecharging.com>',
      };
      return values[key] ?? fallback;
    }),
  };
  const submailService = {
    sendEmail: jest.fn(),
  };
  const twilioSendgridService = {
    sendEmail: jest.fn(),
  };
  const routingService = {
    resolveEmailRoute: jest.fn(),
  };

  const service = new MailService(
    configService as any,
    submailService as any,
    twilioSendgridService as any,
    routingService as any,
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('falls back from SendGrid to Submail outside China', async () => {
    routingService.resolveEmailRoute.mockResolvedValue({
      geoBucket: 'other',
      primary: 'twilio_sendgrid',
      fallback: 'submail',
    });
    twilioSendgridService.sendEmail.mockRejectedValue(
      new Error('sendgrid failure'),
    );
    submailService.sendEmail.mockResolvedValue({ status: 'success' });

    const result = await service.sendMail(
      'user@example.com',
      'Hello',
      '<p>x</p>',
    );

    expect(twilioSendgridService.sendEmail).toHaveBeenCalledTimes(1);
    expect(submailService.sendEmail).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ status: 'success' });
  });

  it('does not fallback for China email when Submail fails', async () => {
    routingService.resolveEmailRoute.mockResolvedValue({
      geoBucket: 'china',
      primary: 'submail',
    });
    submailService.sendEmail.mockRejectedValue(new Error('submail failure'));

    await expect(
      service.sendMail('cn-user@example.com', 'Hello', '<p>x</p>'),
    ).rejects.toThrow('submail failure');
    expect(twilioSendgridService.sendEmail).not.toHaveBeenCalled();
  });
});
