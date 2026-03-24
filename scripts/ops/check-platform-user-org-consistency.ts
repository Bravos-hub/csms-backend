import * as dotenv from 'dotenv';
import { createHash } from 'node:crypto';
import { MembershipStatus, PrismaClient, UserRole } from '@prisma/client';

dotenv.config({ path: process.env.ENV_FILE || '.env' });

const prisma = new PrismaClient();
const EVZONE_WORLD_NAME = 'EVZONE WORLD';
const PLATFORM_ROLES = [
  UserRole.SUPER_ADMIN,
  UserRole.EVZONE_ADMIN,
  UserRole.EVZONE_OPERATOR,
];

function hashIdentifier(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16);
}

async function main() {
  const evzoneOrganization = await prisma.organization.findFirst({
    where: {
      name: { equals: EVZONE_WORLD_NAME, mode: 'insensitive' },
    },
    select: { id: true, name: true },
  });

  if (!evzoneOrganization) {
    console.error(
      JSON.stringify({
        status: 'error',
        reason: `Organization "${EVZONE_WORLD_NAME}" not found`,
      }),
    );
    process.exit(1);
  }

  const platformUsers = await prisma.user.findMany({
    where: {
      role: { in: PLATFORM_ROLES },
    },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      status: true,
      organizationId: true,
    },
  });

  const membershipRows = await prisma.organizationMembership.findMany({
    where: {
      userId: { in: platformUsers.map((user) => user.id) },
      organizationId: evzoneOrganization.id,
    },
    select: {
      userId: true,
      role: true,
      status: true,
    },
  });
  const membershipByUserId = new Map(
    membershipRows.map((membership) => [membership.userId, membership]),
  );

  const usersMissingOrganization = platformUsers
    .filter((user) => !user.organizationId)
    .map((user) => ({
      userIdHash: hashIdentifier(user.id),
      role: user.role,
      status: user.status,
      identifier: user.email || user.name,
    }));

  const usersWithWrongOrganization = platformUsers
    .filter(
      (user) =>
        !!user.organizationId && user.organizationId !== evzoneOrganization.id,
    )
    .map((user) => ({
      userIdHash: hashIdentifier(user.id),
      role: user.role,
      status: user.status,
      identifier: user.email || user.name,
    }));

  const usersMissingMembership = platformUsers
    .filter((user) => !membershipByUserId.has(user.id))
    .map((user) => ({
      userIdHash: hashIdentifier(user.id),
      role: user.role,
      status: user.status,
      identifier: user.email || user.name,
    }));

  const usersWithInactiveMembership = platformUsers
    .filter((user) => {
      const membership = membershipByUserId.get(user.id);
      if (!membership) return false;
      return (
        membership.status !== MembershipStatus.ACTIVE &&
        membership.status !== MembershipStatus.INVITED
      );
    })
    .map((user) => ({
      userIdHash: hashIdentifier(user.id),
      role: user.role,
      status: user.status,
      identifier: user.email || user.name,
      membershipStatus: membershipByUserId.get(user.id)?.status,
    }));

  const usersWithRoleMismatch = platformUsers
    .filter((user) => {
      const membership = membershipByUserId.get(user.id);
      if (!membership) return false;
      return membership.role !== user.role;
    })
    .map((user) => ({
      userIdHash: hashIdentifier(user.id),
      role: user.role,
      status: user.status,
      identifier: user.email || user.name,
      membershipRole: membershipByUserId.get(user.id)?.role,
    }));

  const summary = {
    status: 'ok',
    organizationId: evzoneOrganization.id,
    scannedUsers: platformUsers.length,
    usersMissingOrganization: usersMissingOrganization.length,
    usersWithWrongOrganization: usersWithWrongOrganization.length,
    usersMissingMembership: usersMissingMembership.length,
    usersWithInactiveMembership: usersWithInactiveMembership.length,
    usersWithRoleMismatch: usersWithRoleMismatch.length,
  };

  console.log(
    JSON.stringify(
      {
        summary,
        usersMissingOrganization,
        usersWithWrongOrganization,
        usersMissingMembership,
        usersWithInactiveMembership,
        usersWithRoleMismatch,
      },
      null,
      2,
    ),
  );

  const hasConsistencyFailures =
    usersMissingOrganization.length > 0 ||
    usersWithWrongOrganization.length > 0 ||
    usersMissingMembership.length > 0 ||
    usersWithInactiveMembership.length > 0 ||
    usersWithRoleMismatch.length > 0;

  if (hasConsistencyFailures) {
    process.exit(1);
  }
}

main()
  .catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      JSON.stringify({
        status: 'error',
        reason: message,
      }),
    );
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
