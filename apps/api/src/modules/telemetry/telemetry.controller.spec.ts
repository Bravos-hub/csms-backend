import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { TelemetryController } from './telemetry.controller';
import { TelemetryService } from './telemetry.service';

describe('TelemetryController', () => {
  const telemetry = {
    getVehicleStatus: jest.fn(),
    sendVehicleCommand: jest.fn(),
    getVehicleCommandStatus: jest.fn(),
    validateProviderWebhookSecret: jest.fn(),
    ingestProviderWebhook: jest.fn(),
  };

  const controller = new TelemetryController(
    telemetry as unknown as TelemetryService,
  );

  beforeEach(() => {
    telemetry.getVehicleStatus.mockReset();
    telemetry.sendVehicleCommand.mockReset();
    telemetry.getVehicleCommandStatus.mockReset();
    telemetry.validateProviderWebhookSecret.mockReset();
    telemetry.ingestProviderWebhook.mockReset();
  });

  it('maps simple vehicle command payloads to adapter contract', async () => {
    telemetry.sendVehicleCommand.mockResolvedValue({ accepted: true });

    await controller.sendCommand(
      { sub: 'user-1' },
      'veh-1',
      {
        provider: 'MOCK',
        providerId: 'veh-1',
        command: { type: 'LOCK' },
      },
    );

    expect(telemetry.sendVehicleCommand).toHaveBeenCalledWith(
      'user-1',
      'veh-1',
      {
        command: { type: 'LOCK' },
        provider: 'MOCK',
        providerId: 'veh-1',
      },
    );
  });

  it('requires limitPercent for SET_CHARGE_LIMIT commands', async () => {
    expect(() =>
      controller.sendCommand(
        { sub: 'user-1' },
        'veh-1',
        {
          command: { type: 'SET_CHARGE_LIMIT' },
        },
      ),
    ).toThrow(BadRequestException);
    expect(telemetry.sendVehicleCommand).not.toHaveBeenCalled();
  });

  it('rejects provider webhooks when secret is invalid', async () => {
    telemetry.validateProviderWebhookSecret.mockReturnValue(false);

    expect(() =>
      controller.ingestWebhook('MOCK', undefined, {}),
    ).toThrow(UnauthorizedException);
    expect(telemetry.ingestProviderWebhook).not.toHaveBeenCalled();
  });
});
