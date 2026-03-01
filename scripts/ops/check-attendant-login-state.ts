import 'dotenv/config';
import { createHash } from 'node:crypto';
import { PrismaClient } from '@prisma/client';

interface ParsedArgs {
  identifier: string | null;
}

function parseArgs(argv: string[]): ParsedArgs {
  const identifierFlagIndex = argv.findIndex(
    (entry) => entry === '--identifier' || entry === '-i',
  );

  if (identifierFlagIndex >= 0 && argv[identifierFlagIndex + 1]) {
    return { identifier: argv[identifierFlagIndex + 1] };
  }

  return { identifier: null };
}

function normalizeIdentifier(value: string): string {
  return value.trim().toLowerCase();
}

function normalizePhone(value: string): string {
  return value.replace(/\D/g, '');
}

function hashIdentifier(value: string): string {
  return createHash('sha256')
    .update(normalizeIdentifier(value))
    .digest('hex')
    .slice(0, 16);
}

async function main() {
  const { identifier } = parseArgs(process.argv.slice(2));

  if (!identifier) {
    console.error(
      'Usage: npx tsx ./scripts/ops/check-attendant-login-state.ts --identifier <email-or-phone>',
    );
    process.exit(1);
  }

  const prisma = new PrismaClient();
  const normalizedIdentifier = normalizeIdentifier(identifier);

  try {
    const user = normalizedIdentifier.includes('@')
      ? await prisma.user.findFirst({
          where: {
            email: { equals: normalizedIdentifier, mode: 'insensitive' },
          },
        })
      : (
          await prisma.user.findMany({
            where: { phone: { not: null } },
          })
        ).find(
          (candidate) =>
            normalizePhone(candidate.phone || '') ===
            normalizePhone(normalizedIdentifier),
        ) || null;

    if (!user) {
      console.log(
        JSON.stringify(
          {
            identifier: normalizedIdentifier,
            identifierHash: hashIdentifier(normalizedIdentifier),
            userExists: false,
            assignmentExists: false,
            hasActiveAssignment: false,
          },
          null,
          2,
        ),
      );
      return;
    }

    const assignments = await prisma.attendantAssignment.findMany({
      where: { userId: user.id },
      include: {
        station: {
          select: {
            id: true,
            name: true,
            address: true,
            status: true,
            type: true,
          },
        },
      },
      orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
    });

    const now = new Date();
    const activeAssignment = assignments.find(
      (assignment) =>
        assignment.isActive &&
        (!assignment.activeFrom || assignment.activeFrom <= now) &&
        (!assignment.activeTo || assignment.activeTo >= now),
    );

    console.log(
      JSON.stringify(
        {
          identifier: normalizedIdentifier,
          identifierHash: hashIdentifier(normalizedIdentifier),
          userExists: true,
          user: {
            id: user.id,
            email: user.email,
            phone: user.phone,
            role: user.role,
            status: user.status,
            hasPasswordHash: Boolean(user.passwordHash),
          },
          assignmentExists: assignments.length > 0,
          assignmentCount: assignments.length,
          hasActiveAssignment: Boolean(activeAssignment),
          activeAssignment: activeAssignment
            ? {
                id: activeAssignment.id,
                roleMode: activeAssignment.roleMode,
                stationId: activeAssignment.stationId,
                station: activeAssignment.station,
                shiftStart: activeAssignment.shiftStart,
                shiftEnd: activeAssignment.shiftEnd,
                timezone: activeAssignment.timezone,
                activeFrom: activeAssignment.activeFrom,
                activeTo: activeAssignment.activeTo,
                isActive: activeAssignment.isActive,
              }
            : null,
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
  console.error(`Failed to verify attendant login state: ${message}`);
  process.exit(1);
});
