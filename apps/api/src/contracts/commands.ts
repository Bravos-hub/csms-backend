export interface CommandRequest {
    commandId?: string;
    stationId?: string;
    chargePointId?: string;
    connectorId?: number | string;
    commandType: string;
    payload: Record<string, any>;
    requestedBy?: {
        userId?: string;
    };
    requestedAt?: string;
}

export interface CommandResponse {
    commandId: string;
    status: string;
    requestedAt: string;
    error?: string;
}
