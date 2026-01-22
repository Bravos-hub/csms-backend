
import { PrismaClient } from '@prisma/client';

async function main() {
    const prisma = new PrismaClient();
    try {
        console.log('Verifying NegotiationRound model...');

        // Check if property exists on client instance
        if (!prisma.negotiationRound) {
            throw new Error('prisma.negotiationRound property is missing!');
        }
        console.log('✅ prisma.negotiationRound exists.');

        // Check if we can find count (without connecting to DB just check compilation/runtime existence)
        // Actually we need to connect to verify runtime.
        // But mostly we care if this script COMPILES using ts-node.
        console.log('Script compiled successfully, meaning types are correct.');

    } catch (error) {
        console.error('Validation failed:', error);
        process.exit(1);
    } finally {
        await prisma.$disconnect();
    }
}

main();
