export type CommandRequest = {
    commandId: string;
    commandType: string;
    stationId?: string;
    tenantId?: string;
    chargePointId?: string;
    connectorId?: number;
    ocppVersion?: '1.6J' | '2.0.1' | '2.1';
    requestedBy?: {
        userId?: string;
        role?: string;
        orgId?: string;
    };
    payload?: Record<string, unknown>;
    requestedAt: string;
    timeoutSec?: number;
};

export type DomainEvent = {
    eventId: string;
    eventType: string;
    source: string;
    occurredAt: string;
    correlationId?: string;
    stationId?: string;
    tenantId?: string;
    chargePointId?: string;
    connectorId?: number;
    ocppVersion?: string;
    payload?: Record<string, unknown>;
};

