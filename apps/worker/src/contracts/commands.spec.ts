import {
  COMMAND_CONTRACT_SCHEMA_VERSION,
  validateCommandRequestContract,
  validateDomainEventContract,
} from './commands';

describe('command contracts', () => {
  it('accepts legacy command requests without schemaVersion', () => {
    const result = validateCommandRequestContract({
      commandId: 'cmd-1',
      commandType: 'Reset',
      requestedAt: new Date().toISOString(),
      payload: {},
    });

    expect(result.ok).toBe(true);
  });

  it('accepts current command request schema version', () => {
    const result = validateCommandRequestContract({
      schemaVersion: COMMAND_CONTRACT_SCHEMA_VERSION,
      commandId: 'cmd-2',
      commandType: 'RemoteStart',
      requestedAt: new Date().toISOString(),
      payload: {},
    });

    expect(result.ok).toBe(true);
  });

  it('rejects unsupported command request schema version', () => {
    const result = validateCommandRequestContract({
      schemaVersion: '9.9',
      commandId: 'cmd-3',
      commandType: 'RemoteStop',
      requestedAt: new Date().toISOString(),
      payload: {},
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('Unsupported schemaVersion');
    }
  });

  it('accepts current domain event schema version', () => {
    const result = validateDomainEventContract({
      schemaVersion: COMMAND_CONTRACT_SCHEMA_VERSION,
      eventId: 'evt-1',
      eventType: 'CommandAccepted',
      source: 'ocpp-gateway',
      occurredAt: new Date().toISOString(),
      correlationId: 'cmd-1',
      payload: {},
    });

    expect(result.ok).toBe(true);
  });

  it('rejects malformed domain events', () => {
    const result = validateDomainEventContract({
      eventId: 'evt-2',
      eventType: '',
      source: 'ocpp-gateway',
      occurredAt: 'not-a-date',
    });

    expect(result.ok).toBe(false);
  });
});
