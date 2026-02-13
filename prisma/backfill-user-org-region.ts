import 'dotenv/config';
import { PrismaClient, UserRole } from '@prisma/client';

const prisma = new PrismaClient();

const EVZONE_ROLES = new Set<UserRole>([
  UserRole.SUPER_ADMIN,
  UserRole.EVZONE_ADMIN,
  UserRole.EVZONE_OPERATOR,
]);

function normalizeRegion(region?: string | null): string | null {
  if (!region) return null;
  const normalized = region.trim().toUpperCase().replace(/[\s-]+/g, '_');
  return normalized || null;
}

async function ensureEvzoneOrganization() {
  const existing = await prisma.organization.findFirst({
    where: { name: { equals: 'EVZONE', mode: 'insensitive' } },
  });
  if (existing) return existing;

  return prisma.organization.create({
    data: {
      name: 'EVZONE',
      type: 'COMPANY',
      description: 'Default EVZONE platform organization',
    },
  });
}

async function main() {
  console.log('[backfill] starting user org/region consistency backfill');

  const evzoneOrg = await ensureEvzoneOrganization();
  const zones = await prisma.geographicZone.findMany({
    select: { id: true, code: true, name: true },
  });

  const zoneByLookup = new Map<string, string>();
  const zoneById = new Map<string, { id: string; name: string }>();

  for (const zone of zones) {
    zoneByLookup.set(zone.code.toLowerCase(), zone.id);
    zoneByLookup.set(zone.name.toLowerCase(), zone.id);
    zoneById.set(zone.id, { id: zone.id, name: zone.name });
  }

  const users = await prisma.user.findMany({
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      organizationId: true,
      zoneId: true,
      region: true,
      country: true,
    },
  });

  let updatedCount = 0;
  const unresolved: Array<{ id: string; email: string; reason: string }> = [];

  for (const user of users) {
    const updateData: { organizationId?: string; zoneId?: string; region?: string } = {};

    if (EVZONE_ROLES.has(user.role) && user.organizationId !== evzoneOrg.id) {
      updateData.organizationId = evzoneOrg.id;
    }

    let resolvedZoneId = user.zoneId || null;
    if (!resolvedZoneId) {
      const regionKey = user.region?.trim().toLowerCase();
      const countryKey = user.country?.trim().toLowerCase();
      if (regionKey && zoneByLookup.has(regionKey)) {
        resolvedZoneId = zoneByLookup.get(regionKey) || null;
      } else if (countryKey && zoneByLookup.has(countryKey)) {
        resolvedZoneId = zoneByLookup.get(countryKey) || null;
      }
    }

    if (resolvedZoneId && resolvedZoneId !== user.zoneId) {
      updateData.zoneId = resolvedZoneId;
    }

    const derivedRegion =
      normalizeRegion(user.region) ||
      normalizeRegion(zoneById.get(resolvedZoneId || '')?.name) ||
      null;

    if (derivedRegion && derivedRegion !== user.region) {
      updateData.region = derivedRegion;
    }

    if (!resolvedZoneId) {
      unresolved.push({
        id: user.id,
        email: user.email || user.name,
        reason: 'No resolvable geographic zone from region/country',
      });
    }

    if (Object.keys(updateData).length > 0) {
      await prisma.user.update({
        where: { id: user.id },
        data: updateData,
      });
      updatedCount += 1;
    }
  }

  console.log('[backfill] done');
  console.log(`[backfill] users scanned: ${users.length}`);
  console.log(`[backfill] users updated: ${updatedCount}`);
  console.log(`[backfill] unresolved users: ${unresolved.length}`);

  if (unresolved.length > 0) {
    console.log('[backfill] unresolved sample (first 50):');
    console.table(unresolved.slice(0, 50));
  }
}

main()
  .catch((error) => {
    console.error('[backfill] failed', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
