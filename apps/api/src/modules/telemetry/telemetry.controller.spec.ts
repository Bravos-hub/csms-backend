import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { TelemetryController } from './telemetry.controller';
import { TelemetryService } from './telemetry.service';

describe('TelemetryController', () => {
  const telemetry = {
    getVehicleStatus: jest.fn(),
    sendVehicleCommand: jest.fn(),
    getVehicleCommandStatus: jest.fn(),
    listTelemetrySources: jest.fn(),
    createTelemetrySource: jest.fn(),
    updateTelemetrySource: jest.fn(),
    removeTelemetrySource: jest.fn(),
    setTelemetrySourceEnabled: jest.fn(),
    issueSmartcarToken: jest.fn(),
    refreshSmartcarToken: jest.fn(),
    getSmartcarVehicleStatus: jest.fn(),
    sendSmartcarVehicleCommand: jest.fn(),
    getSmartcarVehicleCommandStatus: jest.fn(),
    ingestSmartcarWebhook: jest.fn(),
    validateProviderWebhookSecret: jest.fn(),
    ingestProviderWebhook: jest.fn(),
    listRawSnapshots: jest.fn(),
    listTelemetryAlerts: jest.fn(),
    runTelemetryRetentionMaintenance: jest.fn(),
  };

  const controller = new TelemetryController(
    telemetry as unknown as TelemetryService,
  );

  beforeEach(() => {
    telemetry.getVehicleStatus.mockReset();
    telemetry.sendVehicleCommand.mockReset();
    telemetry.getVehicleCommandStatus.mockReset();
    telemetry.listTelemetrySources.mockReset();
    telemetry.createTelemetrySource.mockReset();
    telemetry.updateTelemetrySource.mockReset();
    telemetry.removeTelemetrySource.mockReset();
    telemetry.setTelemetrySourceEnabled.mockReset();
    telemetry.issueSmartcarToken.mockReset();
    telemetry.refreshSmartcarToken.mockReset();
    telemetry.getSmartcarVehicleStatus.mockReset();
    telemetry.sendSmartcarVehicleCommand.mockReset();
    telemetry.getSmartcarVehicleCommandStatus.mockReset();
    telemetry.ingestSmartcarWebhook.mockReset();
    telemetry.validateProviderWebhookSecret.mockReset();
    telemetry.ingestProviderWebhook.mockReset();
    telemetry.listRawSnapshots.mockReset();
    telemetry.listTelemetryAlerts.mockReset();
    telemetry.runTelemetryRetentionMaintenance.mockReset();
  });

  it('maps simple vehicle command payloads to service contract', async () => {
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

  it('rejects invalid authenticated user payload', async () => {
    expect(() =>
      controller.getStatus(null, 'veh-1', {}),
    ).toThrow(UnauthorizedException);
    expect(telemetry.getVehicleStatus).not.toHaveBeenCalled();
  });

  it('forwards source CRUD and enable/disable operations', async () => {
    telemetry.listTelemetrySources.mockResolvedValue([]);
    telemetry.createTelemetrySource.mockResolvedValue({ id: 'src-1' });
    telemetry.updateTelemetrySource.mockResolvedValue({ id: 'src-1' });
    telemetry.removeTelemetrySource.mockResolvedValue({ ok: true });
    telemetry.setTelemetrySourceEnabled.mockResolvedValue({ id: 'src-1' });

    await controller.listSources({ sub: 'user-1' }, 'veh-1');
    await controller.createSource(
      { sub: 'user-1' },
      'veh-1',
      {
        provider: 'SMARTCAR',
        providerId: 'sc-veh-1',
        credentialRef: 'cred:tenant:smartcar',
        enabled: true,
        capabilities: ['READ', 'COMMANDS'],
        metadata: { env: 'test' },
      },
    );
    await controller.updateSource(
      { sub: 'user-1' },
      'veh-1',
      'src-1',
      {
        providerId: '',
        credentialRef: 'cred:tenant:smartcar',
      },
    );
    await controller.removeSource({ sub: 'user-1' }, 'veh-1', 'src-1');
    await controller.enableSource({ sub: 'user-1' }, 'veh-1', 'src-1');
    await controller.disableSource({ sub: 'user-1' }, 'veh-1', 'src-1');

    expect(telemetry.listTelemetrySources).toHaveBeenCalledWith(
      'user-1',
      'veh-1',
    );
    expect(telemetry.createTelemetrySource).toHaveBeenCalledWith(
      'user-1',
      'veh-1',
      expect.objectContaining({
        provider: 'SMARTCAR',
        providerId: 'sc-veh-1',
        credentialRef: 'cred:tenant:smartcar',
      }),
    );
    expect(telemetry.updateTelemetrySource).toHaveBeenCalledWith(
      'user-1',
      'veh-1',
      'src-1',
      expect.objectContaining({
        providerId: null,
      }),
    );
    expect(telemetry.removeTelemetrySource).toHaveBeenCalledWith(
      'user-1',
      'veh-1',
      'src-1',
    );
    expect(telemetry.setTelemetrySourceEnabled).toHaveBeenCalledWith(
      'user-1',
      'veh-1',
      'src-1',
      true,
    );
    expect(telemetry.setTelemetrySourceEnabled).toHaveBeenCalledWith(
      'user-1',
      'veh-1',
      'src-1',
      false,
    );
  });

  it('does not overwrite providerId when omitted from source patch payload', async () => {
    telemetry.updateTelemetrySource.mockResolvedValue({ id: 'src-1' });

    await controller.updateSource(
      { sub: 'user-1' },
      'veh-1',
      'src-1',
      {
        enabled: true,
      },
    );

    const updateCalls = telemetry.updateTelemetrySource.mock.calls as Array<
      [string, string, string, Record<string, unknown>]
    >;
    const updatePayload = updateCalls[0]?.[3] || {};
    expect(updatePayload).toEqual({ enabled: true });
    expect(updatePayload).not.toHaveProperty('providerId');
  });

  it('requires provider and credentialRef for source creation', async () => {
    expect(() =>
      controller.createSource(
        { sub: 'user-1' },
        'veh-1',
        {
          credentialRef: 'cred:tenant:smartcar',
        },
      ),
    ).toThrow(BadRequestException);

    expect(() =>
      controller.createSource(
        { sub: 'user-1' },
        'veh-1',
        {
          provider: 'SMARTCAR',
        },
      ),
    ).toThrow(BadRequestException);
  });

  it('forwards smartcar provider operations', async () => {
    telemetry.issueSmartcarToken.mockResolvedValue({ accessToken: 'a' });
    telemetry.refreshSmartcarToken.mockResolvedValue({ accessToken: 'b' });
    telemetry.getSmartcarVehicleStatus.mockResolvedValue({ vehicleId: 'veh-1' });
    telemetry.sendSmartcarVehicleCommand.mockResolvedValue({ accepted: true });
    telemetry.getSmartcarVehicleCommandStatus.mockResolvedValue({ status: 'SENT' });

    await controller.issueSmartcarToken(
      { sub: 'user-1' },
      {
        vehicleId: 'veh-1',
        providerId: 'sc-veh-1',
        credentialRef: 'cred:tenant:smartcar',
      },
    );
    await controller.refreshSmartcarToken(
      { sub: 'user-1' },
      {
        vehicleId: 'veh-1',
        credentialRef: 'cred:tenant:smartcar',
        refreshToken: 'refresh-1',
      },
    );
    await controller.getSmartcarStatus({ sub: 'user-1' }, 'veh-1', 'sc-veh-1');
    await controller.sendSmartcarCommand(
      { sub: 'user-1' },
      'veh-1',
      {
        providerId: 'sc-veh-1',
        command: { type: 'UNLOCK' },
      },
    );
    await controller.getSmartcarCommandStatus({ sub: 'user-1' }, 'veh-1', 'cmd-1');

    expect(telemetry.issueSmartcarToken).toHaveBeenCalledWith('user-1', {
      vehicleId: 'veh-1',
      providerId: 'sc-veh-1',
      credentialRef: 'cred:tenant:smartcar',
    });
    expect(telemetry.refreshSmartcarToken).toHaveBeenCalledWith(
      'user-1',
      {
        vehicleId: 'veh-1',
        credentialRef: 'cred:tenant:smartcar',
        refreshToken: 'refresh-1',
      },
    );
    expect(telemetry.getSmartcarVehicleStatus).toHaveBeenCalledWith(
      'user-1',
      'veh-1',
      'sc-veh-1',
    );
    expect(telemetry.sendSmartcarVehicleCommand).toHaveBeenCalledWith(
      'user-1',
      'veh-1',
      {
        providerId: 'sc-veh-1',
        command: { type: 'UNLOCK' },
      },
    );
    expect(telemetry.getSmartcarVehicleCommandStatus).toHaveBeenCalledWith(
      'user-1',
      'veh-1',
      'cmd-1',
    );
  });

  it('passes raw body and signatures to smartcar webhook ingest', async () => {
    telemetry.ingestSmartcarWebhook.mockResolvedValue({ accepted: true });

    await controller.ingestSmartcarWebhook(
      'sig-1',
      undefined,
      { eventType: 'VEHICLE_STATE' },
      { rawBody: '{"eventType":"VEHICLE_STATE"}' },
    );
    expect(() =>
      controller.ingestSmartcarWebhook(
        undefined,
        'legacy-sig',
        { eventType: 'VEHICLE_STATE' },
        {},
      ),
    ).toThrow(BadRequestException);

    expect(telemetry.ingestSmartcarWebhook).toHaveBeenNthCalledWith(
      1,
      { eventType: 'VEHICLE_STATE' },
      '{"eventType":"VEHICLE_STATE"}',
      'sig-1',
    );
    expect(telemetry.ingestSmartcarWebhook).toHaveBeenCalledTimes(1);
  });

  it('rejects provider webhooks when secret is invalid', async () => {
    telemetry.validateProviderWebhookSecret.mockReturnValue(false);

    expect(() =>
      controller.ingestWebhook('MOCK', undefined, {}),
    ).toThrow(UnauthorizedException);
    expect(telemetry.ingestProviderWebhook).not.toHaveBeenCalled();
  });

  it('forwards storage maintenance endpoints', async () => {
    telemetry.listRawSnapshots.mockResolvedValue([]);
    telemetry.listTelemetryAlerts.mockResolvedValue([]);
    telemetry.runTelemetryRetentionMaintenance.mockResolvedValue({
      removed: 7,
      retentionDays: 90,
    });

    await controller.getRawSnapshots({});
    await controller.getStorageAlerts({ limit: 50 });
    await controller.runStorageRetentionMaintenance();

    expect(telemetry.listRawSnapshots).toHaveBeenCalledWith(100);
    expect(telemetry.listTelemetryAlerts).toHaveBeenCalledWith(50);
    expect(telemetry.runTelemetryRetentionMaintenance).toHaveBeenCalled();
  });
});
