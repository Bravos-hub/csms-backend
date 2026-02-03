
import { PrismaClient, ZoneType } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    console.log('Starting Geography Seeding...');

    // 1. Seed Continents
    const continents = [
        { name: 'Africa', code: 'AF' },
        { name: 'North America', code: 'NA' },
        { name: 'Europe', code: 'EU' },
        { name: 'Asia', code: 'AS' },
        { name: 'Oceania', code: 'OC' },
        { name: 'South America', code: 'SA' },
        { name: 'Antarctica', code: 'AN' },
    ];

    const continentMap = new Map<string, string>();

    for (const c of continents) {
        const zone = await prisma.geographicZone.upsert({
            where: { code: c.code },
            update: {},
            create: {
                name: c.name,
                code: c.code,
                type: ZoneType.CONTINENT
            }
        });
        continentMap.set(c.code, zone.id);
        console.log(`Seeded Continent: ${c.name}`);
    }

    // 2. Seed Example Sub-Regions (e.g. Sub-Saharan Africa)
    // Parent: Africa
    const subSaharan = await prisma.geographicZone.upsert({
        where: { code: 'SUB-SAHARAN-AFRICA' },
        update: {},
        create: {
            name: 'Sub-Saharan Africa',
            code: 'SUB-SAHARAN-AFRICA',
            type: ZoneType.SUB_REGION,
            parentId: continentMap.get('AF')
        }
    });

    // 3. Seed Countries
    // Kenya (in Sub-Saharan Africa)
    const kenya = await prisma.geographicZone.upsert({
        where: { code: 'KE' },
        update: {},
        create: {
            name: 'Kenya',
            code: 'KE',
            type: ZoneType.COUNTRY,
            parentId: subSaharan.id,
            currency: 'KES',
            timezone: 'Africa/Nairobi',
            postalCodeRegex: '^\\d{5}$' // 5 digits
        }
    });

    // USA (in North America)
    const usa = await prisma.geographicZone.upsert({
        where: { code: 'US' },
        update: {},
        create: {
            name: 'United States',
            code: 'US',
            type: ZoneType.COUNTRY,
            parentId: continentMap.get('NA'),
            currency: 'USD',
            timezone: 'America/New_York',
            postalCodeRegex: '^\\d{5}(-\\d{4})?$' // 5 or 9 digits
        }
    });

    // 4. Seed ADM1 (Primary Divisions)
    // Nairobi (County in Kenya)
    await prisma.geographicZone.upsert({
        where: { code: 'KE-30' }, // ISO 3166-2 for Nairobi
        update: {},
        create: {
            name: 'Nairobi City',
            code: 'KE-30',
            type: ZoneType.ADM1, // County
            parentId: kenya.id
        }
    });

    // California (State in USA)
    await prisma.geographicZone.upsert({
        where: { code: 'US-CA' },
        update: {},
        create: {
            name: 'California',
            code: 'US-CA',
            type: ZoneType.ADM1, // State
            parentId: usa.id
        }
    });

    console.log('Seeding completed.');
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
