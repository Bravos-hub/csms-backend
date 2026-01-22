import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    console.log('Attempting to drop legacy TypeORM constraints...');
    try {
        // Drop the specific constraint causing the error
        // Error: cannot drop index "UQ_4527107221143b0530c23ef1d62" because constraint UQ_4527107221143b0530c23ef1d62 on table stations requires it
        await prisma.$executeRawUnsafe(`ALTER TABLE "stations" DROP CONSTRAINT IF EXISTS "UQ_4527107221143b0530c23ef1d62" CASCADE;`);
        console.log('Successfully dropped constraint: UQ_4527107221143b0530c23ef1d62');

        // Check for other potential TypeORM legacy constraints if known?
        // For now, let's fix the blocker.
    } catch (error) {
        console.error('Error dropping constraint:', error);
    } finally {
        await prisma.$disconnect();
    }
}

main();
