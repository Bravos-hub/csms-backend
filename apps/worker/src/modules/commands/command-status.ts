export type CommandStatus =
    | 'Queued'
    | 'Sent'
    | 'Dispatched'
    | 'Accepted'
    | 'Rejected'
    | 'Failed'
    | 'Timeout'
    | 'Duplicate';

const TERMINAL_STATUSES = new Set<CommandStatus>([
    'Accepted',
    'Rejected',
    'Failed',
    'Timeout',
    'Duplicate',
]);

const STATUS_RANK: Record<CommandStatus, number> = {
    Queued: 0,
    Sent: 1,
    Dispatched: 2,
    Accepted: 3,
    Rejected: 3,
    Failed: 3,
    Timeout: 3,
    Duplicate: 3,
};

export const isTerminalStatus = (status: CommandStatus): boolean =>
    TERMINAL_STATUSES.has(status);

export const resolveNextStatus = (
    current: string,
    candidate: CommandStatus,
): CommandStatus | null => {
    if (!isCommandStatus(current)) return candidate;
    if (current === candidate) return candidate;

    if (isTerminalStatus(current)) {
        return null;
    }

    if (STATUS_RANK[candidate] < STATUS_RANK[current]) {
        return null;
    }

    return candidate;
};

export const mapEventTypeToCommandStatus = (eventType: string): CommandStatus | null => {
    switch (eventType) {
        case 'CommandRouted':
            return 'Sent';
        case 'CommandDispatched':
            return 'Dispatched';
        case 'CommandAccepted':
            return 'Accepted';
        case 'CommandRejected':
            return 'Rejected';
        case 'CommandFailed':
            return 'Failed';
        case 'CommandTimeout':
            return 'Timeout';
        case 'CommandDuplicate':
            return 'Duplicate';
        default:
            return null;
    }
};

function isCommandStatus(value: string): value is CommandStatus {
    return [
        'Queued',
        'Sent',
        'Dispatched',
        'Accepted',
        'Rejected',
        'Failed',
        'Timeout',
        'Duplicate',
    ].includes(value);
}

