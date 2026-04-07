import { NotificationService } from './notification-service.service';
import { TwilioService } from './twilio.service';
import { SubmailSmsService } from './submail-sms.service';
import { AfricasTalkingService } from './africas-talking.service';
import { MessagingRoutingService } from '../../common/services/messaging-routing.service';

describe('NotificationService', () => {
  const twilioService = {
    sendSms: jest.fn(),
  };
  const submailSmsService = {
    sendSms: jest.fn(),
  };
  const africasTalkingService = {
    sendSms: jest.fn(),
  };
  const routingService = {
    resolveSmsRoute: jest.fn(),
  };

  const service = new NotificationService(
    twilioService as unknown as TwilioService,
    submailSmsService as unknown as SubmailSmsService,
    africasTalkingService as unknown as AfricasTalkingService,
    routingService as unknown as MessagingRoutingService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('falls back from AfricaTalking to Twilio for Africa SMS', async () => {
    routingService.resolveSmsRoute.mockResolvedValue({
      geoBucket: 'africa',
      primary: 'africas_talking',
      fallback: 'twilio',
    });
    africasTalkingService.sendSms.mockRejectedValue(new Error('AT failure'));
    twilioService.sendSms.mockResolvedValue({ sid: 'twilio-1' });

    const result = await service.sendSms('+254700000001', 'hello', {
      zoneId: 'ke-zone',
    });

    expect(africasTalkingService.sendSms).toHaveBeenCalledWith(
      '+254700000001',
      'hello',
    );
    expect(twilioService.sendSms).toHaveBeenCalledWith(
      '+254700000001',
      'hello',
    );
    expect(result).toEqual({ sid: 'twilio-1' });
  });

  it('does not fallback for China SMS when Submail fails', async () => {
    routingService.resolveSmsRoute.mockResolvedValue({
      geoBucket: 'china',
      primary: 'submail',
    });
    submailSmsService.sendSms.mockRejectedValue(new Error('submail failure'));

    await expect(service.sendSms('+8613000000000', 'hello')).rejects.toThrow(
      'submail failure',
    );
    expect(twilioService.sendSms).not.toHaveBeenCalled();
    expect(africasTalkingService.sendSms).not.toHaveBeenCalled();
  });

  it('falls back from Twilio to Submail for non-China SMS', async () => {
    routingService.resolveSmsRoute.mockResolvedValue({
      geoBucket: 'other',
      primary: 'twilio',
      fallback: 'submail',
    });
    twilioService.sendSms.mockRejectedValue(new Error('twilio failure'));
    submailSmsService.sendSms.mockResolvedValue({ status: 'success' });

    const result = await service.sendSms('+14155550123', 'hello');

    expect(twilioService.sendSms).toHaveBeenCalledWith('+14155550123', 'hello');
    expect(submailSmsService.sendSms).toHaveBeenCalledWith(
      '+14155550123',
      'hello',
    );
    expect(result).toEqual({ status: 'success' });
  });
});
