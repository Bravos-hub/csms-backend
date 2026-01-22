
import { PrismaClient } from '@prisma/client';

async function main() {
    const prisma = new PrismaClient();
    const users = await prisma.user.findMany();
    const stations = await prisma.station.findMany();
    console.log('Users count:', users.length);
    console.log('Users:', JSON.stringify(users, null, 2));
    console.log('Stations count:', stations.length);
    console.log('Stations:', JSON.stringify(stations, null, 2));
    await prisma.$disconnect();
}

main();
