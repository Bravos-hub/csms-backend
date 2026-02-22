import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

type ReplayOptions = {
  dryRun: boolean;
  limit: number;
  commandId?: string;
  olderThanMinutes?: number;
};

function getArgValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index < 0) return undefined;
  return process.argv[index + 1];
}

function parseIntArg(flag: string, fallback: number): number {
  const raw = getArgValue(flag);
  if (!raw) return fallback;
  const parsed = parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function parseBoolArg(flag: string, fallback: boolean): boolean {
  const raw = getArgValue(flag);
  if (!raw) return fallback;
  const normalized = raw.trim().toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  return fallback;
}

function parseOptions(): ReplayOptions {
  const dryRun = parseBoolArg('--dry-run', true);
  const limit = parseIntArg('--limit', 100);
  const commandId = getArgValue('--command-id');
  const olderThanMinutesRaw = getArgValue('--older-than-minutes');
  const olderThanMinutes = olderThanMinutesRaw
    ? parseInt(olderThanMinutesRaw, 10)
    : undefined;

  return {
    dryRun,
    limit,
    commandId: commandId || undefined,
    olderThanMinutes:
      olderThanMinutes &&
      Number.isFinite(olderThanMinutes) &&
      olderThanMinutes > 0
        ? olderThanMinutes
        : undefined,
  };
}

async function main() {
  const options = parseOptions();
  const now = new Date();
  const olderThanCutoff = options.olderThanMinutes
    ? new Date(now.getTime() - options.olderThanMinutes * 60 * 1000)
    : undefined;

  const where = {
    status: 'DeadLettered',
    ...(options.commandId ? { commandId: options.commandId } : {}),
    ...(olderThanCutoff ? { updatedAt: { lt: olderThanCutoff } } : {}),
  };

  const candidates = await prisma.commandOutbox.findMany({
    where,
    orderBy: { updatedAt: 'asc' },
    take: options.limit,
    select: {
      id: true,
      commandId: true,
      attempts: true,
      updatedAt: true,
      lastError: true,
    },
  });

  console.log(
    `[replay-dead-letters] matching records: ${candidates.length} (limit=${options.limit}, dryRun=${options.dryRun})`,
  );

  if (candidates.length === 0) {
    return;
  }

  for (const item of candidates) {
    console.log(
      `- outboxId=${item.id} commandId=${item.commandId} attempts=${item.attempts} updatedAt=${item.updatedAt.toISOString()} lastError=${item.lastError || ''}`,
    );
  }

  if (options.dryRun) {
    console.log(
      '[replay-dead-letters] dry-run only. Re-run with --dry-run false to apply updates.',
    );
    return;
  }

  let replayed = 0;
  for (const item of candidates) {
    const replayedAt = new Date();
    await prisma.$transaction(async (tx) => {
      await tx.commandOutbox.update({
        where: { id: item.id },
        data: {
          status: 'Queued',
          attempts: 0,
          lockedAt: null,
          publishedAt: null,
          lastError: null,
          updatedAt: replayedAt,
        },
      });

      await tx.command.update({
        where: { id: item.commandId },
        data: {
          status: 'Queued',
          error: null,
          sentAt: null,
          completedAt: null,
        },
      });

      await tx.commandEvent.create({
        data: {
          commandId: item.commandId,
          status: 'ReplayRequested',
          payload: {
            replayedFromOutboxId: item.id,
            previousAttempts: item.attempts,
            previousError: item.lastError,
            replayedAt: replayedAt.toISOString(),
          },
          occurredAt: replayedAt,
        },
      });
    });
    replayed += 1;
  }

  console.log(`[replay-dead-letters] replayed records: ${replayed}`);
}

main()
  .catch((error) => {
    console.error('[replay-dead-letters] failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
