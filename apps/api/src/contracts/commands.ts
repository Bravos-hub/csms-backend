export interface CommandRequest {
    commandId?: string;
    stationId?: string;
    tenantId?: string;
    chargePointId?: string;
    connectorId?: number;
    ocppVersion?: '1.6J' | '2.0.1' | '2.1';
    commandType: string;
    payload: Record<string, unknown>;
    requestedBy?: {
        userId?: string;
        role?: string;
        orgId?: string;
    };
    requestedAt?: string;
    timeoutSec?: number;
}

export interface CommandResponse {
    commandId: string;
    status: string;
    requestedAt: string;
    error?: string;
}
