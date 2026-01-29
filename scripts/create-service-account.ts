import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import crypto from 'crypto';
// Use CommonJS require to avoid needing TypeScript type declarations.
const dotenv = require('dotenv');
dotenv.config();

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL environment variable is not set');
}

const rejectUnauthorized = process.env.PG_SSL_REJECT_UNAUTHORIZED !== 'false';
const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized },
});
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

function getArgValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

function parseScopes(input: string | undefined): string[] {
  if (!input) return [];
  return input
    .split(/[,\s]+/)
    .map((value) => value.trim())
    .filter(Boolean);
}

async function main() {
  const name = getArgValue('--name') || 'ocpi-gateway';
  const clientId = getArgValue('--client-id') || crypto.randomUUID();
  const providedSecret = getArgValue('--client-secret');
  const scopes = parseScopes(getArgValue('--scopes'));

  const clientSecret =
    providedSecret || crypto.randomBytes(32).toString('base64url');
  const salt = crypto.randomBytes(16).toString('hex');
  const secretHash = crypto.scryptSync(clientSecret, salt, 64).toString('hex');

  await prisma.serviceAccount.create({
    data: {
      name,
      clientId,
      secretHash,
      secretSalt: salt,
      scopes: scopes.length > 0 ? scopes : undefined,
      status: 'ACTIVE',
    },
  });

  console.log('Service account created');
  console.log(`clientId: ${clientId}`);
  console.log(`clientSecret: ${clientSecret}`);
  if (scopes.length > 0) {
    console.log(`scopes: ${scopes.join(' ')}`);
  }
}

main()
  .catch((error) => {
    console.error('Failed to create service account:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
