import { Client } from 'pg';
import * as dotenv from 'dotenv';
dotenv.config();

// Force bypass for native Node SSL if needed
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

async function test() {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
        console.error('DATABASE_URL not found');
        return;
    }

    const urlObj = new URL(connectionString);
    urlObj.searchParams.delete('sslmode');

    const client = new Client({
        connectionString: urlObj.toString(),
        ssl: { rejectUnauthorized: false }
    });

    console.log('Connecting to:', urlObj.host);
    try {
        await client.connect();
        console.log('Connected successfully!');
        const res = await client.query('SELECT NOW()');
        console.log('Query result:', res.rows[0]);

        // Check station count
        const stations = await client.query('SELECT count(*) FROM stations');
        console.log('Station count:', stations.rows[0].count);

        await client.end();
    } catch (err) {
        console.error('Connection error:', err);
    }
}

test();
