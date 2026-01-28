const { Client } = require('pg');
require('dotenv').config();

async function testConnection() {
    try {
        const connectionString = process.env.DATABASE_URL;
        if (!connectionString) {
            throw new Error('DATABASE_URL environment variable is not set');
        }
        console.log('Using connection string:', connectionString.split('@')[1]); // Log host part only for safety

        const client = new Client({
            connectionString: connectionString,
            ssl: {
                rejectUnauthorized: false
            }
        });

        try {
            console.log('Attempting to connect to database...');
            await client.connect();
            console.log('Connected successfully!');
            const res = await client.query('SELECT NOW()');            console.log('Database time:', res.rows[0]);
            await client.end();
        } catch (err) {
            console.error('Connection failed:', err.message);
            if (err.stack) console.error(err.stack);
            throw err;
        }
    } catch (err) {
        console.error('Error:', err.message);
        process.exit(1);
    }
}

testConnection();
