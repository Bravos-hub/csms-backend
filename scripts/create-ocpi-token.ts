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

async function main() {
  const countryCode = getArgValue('--country-code') || 'US';
  const partyId = getArgValue('--party-id') || 'EVZ';
  const tokenUid = getArgValue('--token-uid') || crypto.randomUUID();
  const tokenType = getArgValue('--token-type') || 'RFID';
  const contractId = getArgValue('--contract-id') || tokenUid;
  const issuer = getArgValue('--issuer') || 'EVzone';
  const valid = getArgValue('--valid') !== 'false';
  const whitelist = getArgValue('--whitelist') || 'ALLOWED';

  const data = {
    country_code: countryCode,
    party_id: partyId,
    uid: tokenUid,
    type: tokenType,
    contract_id: contractId,
    issuer,
    valid,
    whitelist,
    last_updated: new Date().toISOString(),
  };

  const existing = await prisma.ocpiToken.findUnique({
    where: {
      countryCode_partyId_tokenUid_tokenType: {
        countryCode,
        partyId,
        tokenUid,
        tokenType,
      },
    },
  });

  if (existing) {
    await prisma.ocpiToken.update({
      where: { id: existing.id },
      data: {
        data,
        lastUpdated: new Date(),
        valid,
      },
    });
  } else {
    await prisma.ocpiToken.create({
      data: {
        countryCode,
        partyId,
        tokenUid,
        tokenType,
        data,
        lastUpdated: new Date(),
        valid,
      },
    });
  }

  console.log('OCPI token upserted');
  console.log(`countryCode: ${countryCode}`);
  console.log(`partyId: ${partyId}`);
  console.log(`tokenUid: ${tokenUid}`);
  console.log(`tokenType: ${tokenType}`);
}

main()
  .catch((error) => {
    console.error('Failed to upsert OCPI token:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
