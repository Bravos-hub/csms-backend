const { Client } = require('pg');
require('dotenv').config();

async function checkPostGIS() {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
        console.error('DATABASE_URL not set');
        process.exit(1);
    }

    const client = new Client({
        connectionString: connectionString,
        ssl: { rejectUnauthorized: false }
    });

    try {
        await client.connect();
        console.log('Connected to DB. Checking extensions...');

        const extRes = await client.query('SELECT extname FROM pg_extension');
        const extensions = extRes.rows.map(r => r.extname);
        console.log('Available extensions:', extensions);

        const hasPostGIS = extensions.includes('postgis');

        if (!hasPostGIS) {
            console.log('PostGIS not found in extensions. Attempting to check for ST_AsMVT function...');
            const funcRes = await client.query("SELECT routine_name FROM information_schema.routines WHERE routine_name = 'st_asmvt'");
            if (funcRes.rows.length > 0) {
                console.log('Found ST_AsMVT function!');
            } else {
                console.log('ST_AsMVT function not found.');
            }
        } else {
            console.log('PostGIS is enabled!');
        }

        await client.end();
    } catch (err) {
        console.error('Check failed:', err.message);
        process.exit(1);
    }
}

checkPostGIS();
