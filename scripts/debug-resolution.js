const path = require('path');
try {
    const prismaClientPath = require.resolve('@prisma/client');
    console.log('Resolved @prisma/client to:', prismaClientPath);

    const prismaPath = path.dirname(prismaClientPath);
    const pkg = require(path.join(prismaPath, 'package.json'));
    console.log('@prisma/client version:', pkg.version);
    console.log('@prisma/client types:', pkg.types);

    // Check where the types point to
    const typesPath = path.resolve(prismaPath, pkg.types);
    console.log('Types resolve to:', typesPath);

} catch (e) {
    console.error('Failed to resolve @prisma/client:', e);
}
