type WorkerSettings = {
    port: number;
    outbox: {
        enabled: boolean;
    };
    commandEvents: {
        enabled: boolean;
    };
};

const parseBool = (value: string | undefined, fallback: boolean): boolean => {
    if (!value) return fallback;
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
    throw new Error(`Invalid boolean value "${value}"`);
};

const parseIntOrThrow = (value: string | undefined, fallback: number, key: string): number => {
    const raw = value ?? String(fallback);
    const parsed = parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error(`${key} must be a positive integer`);
    }
    return parsed;
};

export function readWorkerSettingsOrThrow(env: NodeJS.ProcessEnv = process.env): WorkerSettings {
    if (!env.DATABASE_URL) {
        throw new Error('DATABASE_URL is required');
    }

    const brokers = (env.KAFKA_BROKERS ?? '')
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean);
    if (brokers.length === 0) {
        throw new Error('KAFKA_BROKERS is required');
    }

    return {
        port: parseIntOrThrow(env.WORKER_PORT, 3010, 'WORKER_PORT'),
        outbox: {
            enabled: parseBool(env.OUTBOX_ENABLED, true),
        },
        commandEvents: {
            enabled: parseBool(env.WORKER_COMMAND_EVENTS_ENABLED, true),
        },
    };
}

