
// Load environment variables
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    console.log('Starting Zone Backfill...');

    // 1. Get all Zones for lookup
    const zones = await prisma.geographicZone.findMany();
    const zoneMap = new Map<string, string>(); // Name/Code -> ID

    zones.forEach(z => {
        zoneMap.set(z.code.toLowerCase(), z.id);
        zoneMap.set(z.name.toLowerCase(), z.id);
    });

    // 2. Backfill Stations
    const stations = await prisma.station.findMany({
        where: { zoneId: null },
        include: { owner: true }
    });

    console.log(`Found ${stations.length} stations to backfill.`);

    for (const s of stations) {
        let zoneId: string | undefined;

        // Try to match station address/city if available (this is tricky without structured data)
        // For now, let's look at owner's region/country
        if (s.owner) {
            const region = s.owner.region?.toLowerCase();
            const country = s.owner.country?.toLowerCase();

            if (region && zoneMap.has(region)) zoneId = zoneMap.get(region);
            else if (country && zoneMap.has(country)) zoneId = zoneMap.get(country);
        }

        // Hardcoded fallbacks for known test data
        // "Kampala" -> Nairobi (closest match in seed) or create Kampala?
        // Seed has "Nairobi City" and "California"
        // If your test data uses "Kampala", we might want to seed Kampala first or map it to Nairobi (incorrect but good for test)

        if (!zoneId) {
            // Try to map generic terms or create Ad-Hoc zones? 
            // For safety, we only map exact matches from the seed.
        }

        if (zoneId) {
            await prisma.station.update({
                where: { id: s.id },
                data: { zoneId }
            });
            console.log(`Updated Station ${s.name} -> Zone ${zoneId}`);
        }
    }

    // 3. Backfill Users
    const users = await prisma.user.findMany({
        where: { zoneId: null }
    });

    console.log(`Found ${users.length} users to backfill.`);

    for (const u of users) {
        let zoneId: string | undefined;
        const region = u.region?.toLowerCase();
        const country = u.country?.toLowerCase();

        if (region && zoneMap.has(region)) zoneId = zoneMap.get(region);
        else if (country && zoneMap.has(country)) zoneId = zoneMap.get(country);

        if (zoneId) {
            await prisma.user.update({
                where: { id: u.id },
                data: { zoneId }
            });
            console.log(`Updated User ${u.name} -> Zone ${zoneId}`);
        }
    }

    console.log('Backfill complete.');
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
