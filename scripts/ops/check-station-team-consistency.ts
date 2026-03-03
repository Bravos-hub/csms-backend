import 'dotenv/config';
import { createHash } from 'node:crypto';
import { PrismaClient, UserRole } from '@prisma/client';

function hashIdentifier(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16);
}

function isPlatformRole(role: UserRole): boolean {
  return (
    role === UserRole.SUPER_ADMIN ||
    role === UserRole.EVZONE_ADMIN ||
    role === UserRole.EVZONE_OPERATOR
  );
}

async function main() {
  const prisma = new PrismaClient();

  try {
    const teamAttendants = await (prisma as any).stationTeamAssignment.findMany({
      where: {
        role: UserRole.ATTENDANT,
        isActive: true,
      },
      select: {
        id: true,
        userId: true,
        stationId: true,
      },
    });

    const attendantAssignments = await prisma.attendantAssignment.findMany({
      where: { isActive: true },
      select: {
        id: true,
        userId: true,
        stationId: true,
      },
    });

    const teamKeys = new Set(
      teamAttendants.map((row: { userId: string; stationId: string }) => `${row.userId}:${row.stationId}`),
    );
    const attendantKeys = new Set(
      attendantAssignments.map((row) => `${row.userId}:${row.stationId}`),
    );

    const missingInAttendant = teamAttendants
      .filter((row: { userId: string; stationId: string }) => !attendantKeys.has(`${row.userId}:${row.stationId}`))
      .map((row: { id: string; userId: string; stationId: string }) => ({
        stationTeamAssignmentId: row.id,
        userIdHash: hashIdentifier(row.userId),
        stationId: row.stationId,
      }));

    const missingInStationTeam = attendantAssignments
      .filter((row) => !teamKeys.has(`${row.userId}:${row.stationId}`))
      .map((row) => ({
        attendantAssignmentId: row.id,
        userIdHash: hashIdentifier(row.userId),
        stationId: row.stationId,
      }));

    const activeUsers = await prisma.user.findMany({
      where: {
        status: 'Active',
      },
      select: {
        id: true,
        role: true,
      },
    });

    const activeUserIdsWithAssignments = new Set(
      (
        await (prisma as any).stationTeamAssignment.findMany({
          where: {
            isActive: true,
          },
          select: { userId: true },
        })
      ).map((row: { userId: string }) => row.userId),
    );

    const activeUsersWithoutAssignments = activeUsers
      .filter((user) => !isPlatformRole(user.role as UserRole))
      .filter((user) => !activeUserIdsWithAssignments.has(user.id))
      .map((user) => ({
        userIdHash: hashIdentifier(user.id),
        role: user.role,
      }));

    console.log(
      JSON.stringify(
        {
          counts: {
            stationTeamAttendantActive: teamAttendants.length,
            attendantAssignmentsActive: attendantAssignments.length,
            missingInAttendant: missingInAttendant.length,
            missingInStationTeam: missingInStationTeam.length,
            activeUsersWithoutAssignments: activeUsersWithoutAssignments.length,
          },
          missingInAttendant,
          missingInStationTeam,
          activeUsersWithoutAssignments,
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
  console.error(`Failed to check station-team consistency: ${message}`);
  process.exit(1);
});
