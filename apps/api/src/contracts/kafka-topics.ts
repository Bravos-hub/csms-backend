export const KAFKA_TOPICS = {
    commandRequests: 'ocpp.commands',
    commandResponses: 'ocpp.responses',
    legacyStationEvents: 'ocpp.events',
    stationEvents: 'ocpp.station.events',
    sessionEvents: 'ocpp.session.events',
} as const;
