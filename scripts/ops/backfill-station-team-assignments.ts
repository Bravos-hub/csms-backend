import 'dotenv/config';
import { PrismaClient, UserRole } from '@prisma/client';

type Flags = {
  dryRun: boolean;
};

function parseFlags(argv: string[]): Flags {
  return {
    dryRun: argv.includes('--dry-run'),
  };
}

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  const prisma = new PrismaClient();

  const result = {
    processed: 0,
    created: 0,
    skipped: 0,
    failures: 0,
  };

  try {
    const sourceAssignments = await prisma.attendantAssignment.findMany({
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });

    for (const source of sourceAssignments) {
      result.processed += 1;

      const exists = await (prisma as any).stationTeamAssignment.findFirst({
        where: {
          userId: source.userId,
          stationId: source.stationId,
          role: UserRole.ATTENDANT,
          isActive: source.isActive,
        },
      });

      if (exists) {
        result.skipped += 1;
        continue;
      }

      const hasPrimary = await (prisma as any).stationTeamAssignment.findFirst({
        where: {
          userId: source.userId,
          isPrimary: true,
          isActive: true,
        },
      });

      if (!flags.dryRun) {
        try {
          await (prisma as any).stationTeamAssignment.create({
            data: {
              userId: source.userId,
              stationId: source.stationId,
              role: UserRole.ATTENDANT,
              isPrimary: !hasPrimary && source.isActive,
              isActive: source.isActive,
              attendantMode: source.roleMode,
              shiftStart: source.shiftStart,
              shiftEnd: source.shiftEnd,
              timezone: source.timezone,
            },
          });
          result.created += 1;
        } catch (error) {
          result.failures += 1;
          console.error(
            `Failed to backfill assignment ${source.id}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      } else {
        result.created += 1;
      }
    }

    if (!flags.dryRun) {
      const usersMissingPrimary = await (prisma as any).stationTeamAssignment.findMany({
        where: {
          isActive: true,
        },
        select: { userId: true },
      });

      const uniqueUserIds = Array.from(new Set(usersMissingPrimary.map((row: { userId: string }) => row.userId)));
      for (const userId of uniqueUserIds) {
        const hasPrimary = await (prisma as any).stationTeamAssignment.findFirst({
          where: {
            userId,
            isActive: true,
            isPrimary: true,
          },
        });

        if (hasPrimary) continue;

        const firstActive = await (prisma as any).stationTeamAssignment.findFirst({
          where: {
            userId,
            isActive: true,
          },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        });

        if (firstActive) {
          await (prisma as any).stationTeamAssignment.update({
            where: { id: firstActive.id },
            data: { isPrimary: true },
          });
        }
      }
    }

    console.log(
      JSON.stringify(
        {
          dryRun: flags.dryRun,
          ...result,
        },
        null,
        2,
      ),
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Failed to backfill station team assignments: ${message}`);
  process.exit(1);
});
