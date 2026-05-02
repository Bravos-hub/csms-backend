import { UnauthorizedException } from '@nestjs/common';
import { DiagnosticsController } from './diagnostics.controller';
import { DiagnosticsService } from './diagnostics.service';

describe('DiagnosticsController', () => {
  const diagnostics = {
    getFaults: jest.fn(),
    acknowledgeFault: jest.fn(),
    resolveFault: jest.fn(),
  };

  const controller = new DiagnosticsController(
    diagnostics as unknown as DiagnosticsService,
  );

  beforeEach(() => {
    diagnostics.getFaults.mockReset();
    diagnostics.acknowledgeFault.mockReset();
    diagnostics.resolveFault.mockReset();
  });

  it('forwards fault lifecycle operations using authenticated subject id', async () => {
    diagnostics.acknowledgeFault.mockResolvedValue({ ok: true });
    diagnostics.resolveFault.mockResolvedValue({ ok: true });

    await controller.acknowledgeFault(
      { sub: 'user-1' },
      'fault-1',
      { note: 'ack-note' },
    );
    await controller.resolveFault(
      { sub: 'user-1' },
      'fault-1',
      { note: 'resolve-note' },
    );

    expect(diagnostics.acknowledgeFault).toHaveBeenCalledWith(
      'user-1',
      'fault-1',
      'ack-note',
    );
    expect(diagnostics.resolveFault).toHaveBeenCalledWith(
      'user-1',
      'fault-1',
      'resolve-note',
    );
  });

  it('keeps delete alias behavior for engine clearFault compatibility', async () => {
    diagnostics.resolveFault.mockResolvedValue({ ok: true });

    await controller.clearFault(
      { sub: 'user-legacy' },
      'fault-legacy-1',
      { note: 'legacy-clear-fault' },
    );
    await controller.clearFault(
      { sub: 'user-legacy' },
      'fault-legacy-2',
      undefined,
    );

    expect(diagnostics.resolveFault).toHaveBeenNthCalledWith(
      1,
      'user-legacy',
      'fault-legacy-1',
      'legacy-clear-fault',
    );
    expect(diagnostics.resolveFault).toHaveBeenNthCalledWith(
      2,
      'user-legacy',
      'fault-legacy-2',
      undefined,
    );
  });

  it('rejects invalid authenticated user payloads', async () => {
    expect(() =>
      controller.getFaults({} as unknown, 'veh-1'),
    ).toThrow(UnauthorizedException);
    expect(() =>
      controller.clearFault(null, 'fault-1', { note: 'x' }),
    ).toThrow(UnauthorizedException);
  });
});
