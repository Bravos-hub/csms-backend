const topic = (envKey: string, fallback: string): string => {
    const value = process.env[envKey];
    if (!value) return fallback;
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : fallback;
};

export const KAFKA_TOPICS = {
    commandRequests: topic('KAFKA_TOPIC_COMMAND_REQUESTS', 'cpms.command.requests'),
    commandRequestsNodePrefix: topic('KAFKA_TOPIC_COMMAND_REQUESTS_NODE_PREFIX', 'cpms.command.requests.node'),
    sessionControlNodePrefix: topic('KAFKA_TOPIC_SESSION_CONTROL_NODE_PREFIX', 'ocpp.session.control.node'),
    commandEvents: topic('KAFKA_TOPIC_COMMAND_EVENTS', 'ocpp.command.events'),
    commandDeadLetters: topic('KAFKA_TOPIC_COMMAND_DEAD_LETTERS', 'cpms.command.dead_letters'),
    legacyStationEvents: topic('KAFKA_TOPIC_LEGACY_STATION_EVENTS', 'ocpp.events'),
    stationEvents: topic('KAFKA_TOPIC_STATION_EVENTS', 'ocpp.station.events'),
    sessionEvents: topic('KAFKA_TOPIC_SESSION_EVENTS', 'ocpp.session.events'),
    auditEvents: topic('KAFKA_TOPIC_AUDIT_EVENTS', 'cpms.audit.events'),
} as const;

export function validateKafkaTopicsOrThrow(topics = KAFKA_TOPICS): void {
    const entries = Object.entries(topics);
    const empty = entries.filter(([, value]) => !value || value.trim().length === 0);
    if (empty.length > 0) {
        const names = empty.map(([key]) => key).join(', ');
        throw new Error(`Kafka topic configuration contains empty values for: ${names}`);
    }
}

