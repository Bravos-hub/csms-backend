import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    console.log('Starting migration for legacy STATION_OWNER users without an organization...');

    // 1. Find all users who are STATION_OWNERs but have no organizationId
    const legacyUsers = await prisma.user.findMany({
        where: {
            role: 'STATION_OWNER',
            organizationId: null,
        },
    });

    if (legacyUsers.length === 0) {
        console.log('No legacy STATION_OWNER users found requiring migration. Exiting.');
        return;
    }

    console.log(`Found ${legacyUsers.length} users to migrate.`);

    // 2. Iterate and create a personal organization for each
    for (const user of legacyUsers) {
        console.log(`Migrating user: ${user.email || user.id}`);

        // Create the organization
        // Determine a name for the org (fallback to email or ID if name is missing)
        const orgName = user.name ? `${user.name} LLC` : `${user.email?.split('@')[0] || user.id} LLC`;

        try {
            const org = await prisma.organization.create({
                data: {
                    name: orgName,
                    type: 'INDIVIDUAL',
                    description: 'Auto-generated personal organization',
                },
            });

            // Link the user to the newly created organization
            await prisma.user.update({
                where: { id: user.id },
                data: { organizationId: org.id },
            });

            console.log(`✅ Success: User ${user.id} linked to Organization ${org.id} (${orgName})`);
        } catch (e) {
            console.error(`❌ Failed to migrate user ${user.id}:`, e);
        }
    }

    console.log('Migration complete!');
}

main()
    .catch((e) => {
        console.error('Migration failed with error:', e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
