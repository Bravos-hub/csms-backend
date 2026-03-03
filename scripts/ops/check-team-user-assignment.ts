import 'dotenv/config';
import { createHash } from 'node:crypto';
import { PrismaClient } from '@prisma/client';

function hashIdentifier(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16);
}

function parseIdentifier(argv: string[]): string {
  const explicitFlag = argv.find((value) => value.startsWith('--identifier='));
  if (explicitFlag) {
    return explicitFlag.split('=').slice(1).join('=').trim();
  }

  const index = argv.indexOf('--identifier');
  if (index >= 0 && argv[index + 1]) {
    return argv[index + 1].trim();
  }

  const positional = argv.find((value) => !value.startsWith('--'));
  return positional?.trim() || '';
}

async function main() {
  const identifier = parseIdentifier(process.argv.slice(2));
  if (!identifier) {
    throw new Error(
      'Missing identifier. Use --identifier=<email_or_phone> (or pass positional value).',
    );
  }

  const normalized = identifier.trim().toLowerCase();
  const prisma = new PrismaClient();

  try {
    const user = await prisma.user.findFirst({
      where: {
        OR: [{ email: { equals: normalized, mode: 'insensitive' } }, { phone: identifier.trim() }],
      },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        status: true,
        organizationId: true,
        lastStationAssignmentId: true,
        memberships: {
          select: {
            organizationId: true,
            role: true,
            status: true,
          },
        },
      },
    });

    if (!user) {
      console.log(
        JSON.stringify(
          {
            found: false,
            identifierHash: hashIdentifier(normalized),
          },
          null,
          2,
        ),
      );
      return;
    }

    const stationAssignments = await (prisma as any).stationTeamAssignment.findMany({
      where: { userId: user.id },
      include: {
        station: {
          select: {
            id: true,
            name: true,
            orgId: true,
          },
        },
      },
      orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
    });

    const attendantAssignments = await prisma.attendantAssignment.findMany({
      where: { userId: user.id },
      select: {
        id: true,
        stationId: true,
        roleMode: true,
        shiftStart: true,
        shiftEnd: true,
        timezone: true,
        isActive: true,
      },
      orderBy: [{ isActive: 'desc' }, { createdAt: 'asc' }],
    });

    const activeStationAssignments = stationAssignments.filter(
      (assignment: { isActive: boolean }) => assignment.isActive,
    );
    const activeAttendantAssignments = attendantAssignments.filter(
      (assignment) => assignment.isActive,
    );

    console.log(
      JSON.stringify(
        {
          found: true,
          identifierHash: hashIdentifier(user.email || user.phone || user.id),
          user: {
            id: user.id,
            name: user.name,
            email: user.email,
            phone: user.phone,
            role: user.role,
            status: user.status,
            organizationId: user.organizationId,
            lastStationAssignmentId: user.lastStationAssignmentId,
          },
          memberships: user.memberships,
          summary: {
            activeStationTeamAssignments: activeStationAssignments.length,
            activeAttendantAssignments: activeAttendantAssignments.length,
            assignmentProjectionAligned:
              activeStationAssignments.filter(
                (assignment: { role: string }) => assignment.role === 'ATTENDANT',
              ).length === activeAttendantAssignments.length,
          },
          stationTeamAssignments: stationAssignments,
          attendantAssignments,
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
  console.error(`Failed to check team user assignment state: ${message}`);
  process.exit(1);
});
