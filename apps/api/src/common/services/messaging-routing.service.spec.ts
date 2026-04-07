/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument */
import { ZoneType } from '@prisma/client';
import { MessagingRoutingService } from './messaging-routing.service';

function createPrismaMock(args?: {
  zonesById?: Record<
    string,
    {
      id: string;
      code: string;
      name: string;
      type: ZoneType;
      parentId: string | null;
    }
  >;
  zoneIdsByCandidate?: Record<string, string>;
  userByEmail?: Record<
    string,
    {
      id: string;
      zoneId: string | null;
      country: string | null;
      region: string | null;
    }
  >;
  userById?: Record<
    string,
    { zoneId: string | null; country: string | null; region: string | null }
  >;
}) {
  const zonesById = args?.zonesById || {};
  const zoneIdsByCandidate = args?.zoneIdsByCandidate || {};
  const userByEmail = args?.userByEmail || {};
  const userById = args?.userById || {};

  return {
    user: {
      findUnique: jest.fn().mockImplementation(({ where }) => {
        const user = userById[where.id];
        return Promise.resolve(user || null);
      }),
      findFirst: jest.fn().mockImplementation(({ where }) => {
        const email = where?.email?.equals;
        if (!email) return Promise.resolve(null);
        const user = userByEmail[String(email).toLowerCase()];
        return Promise.resolve(user || null);
      }),
    },
    geographicZone: {
      findUnique: jest.fn().mockImplementation(({ where }) => {
        return Promise.resolve(zonesById[where.id] || null);
      }),
      findFirst: jest.fn().mockImplementation(({ where }) => {
        const or = where?.OR || [];
        for (const clause of or) {
          const code = clause?.code?.equals;
          if (code) {
            const id = zoneIdsByCandidate[String(code).toUpperCase()];
            if (id) return Promise.resolve({ id });
          }
          const name = clause?.name?.equals;
          if (name) {
            const id = zoneIdsByCandidate[String(name).toUpperCase()];
            if (id) return Promise.resolve({ id });
          }
        }
        return Promise.resolve(null);
      }),
    },
  };
}

describe('MessagingRoutingService', () => {
  it('routes China recipients to Submail (no fallback)', async () => {
    const prisma = createPrismaMock({
      zonesById: {
        'cn-zone': {
          id: 'cn-zone',
          code: 'CN',
          name: 'China',
          type: ZoneType.COUNTRY,
          parentId: 'asia-zone',
        },
        'asia-zone': {
          id: 'asia-zone',
          code: 'AS',
          name: 'Asia',
          type: ZoneType.CONTINENT,
          parentId: null,
        },
      },
    });
    const service = new MessagingRoutingService(prisma as any);

    const route = await service.resolveSmsRoute({
      to: '+8613000000000',
      context: { zoneId: 'cn-zone' },
    });

    expect(route).toEqual({
      geoBucket: 'china',
      primary: 'submail',
    });
  });

  it('routes Africa recipients to AfricaTalking then Twilio fallback for SMS', async () => {
    const prisma = createPrismaMock({
      zonesById: {
        'ke-zone': {
          id: 'ke-zone',
          code: 'KE',
          name: 'Kenya',
          type: ZoneType.COUNTRY,
          parentId: 'af-zone',
        },
        'af-zone': {
          id: 'af-zone',
          code: 'AF',
          name: 'Africa',
          type: ZoneType.CONTINENT,
          parentId: null,
        },
      },
    });
    const service = new MessagingRoutingService(prisma as any);

    const route = await service.resolveSmsRoute({
      to: '+254700000001',
      context: { zoneId: 'ke-zone' },
    });

    expect(route).toEqual({
      geoBucket: 'africa',
      primary: 'africas_talking',
      fallback: 'twilio',
    });
  });

  it('routes non-Africa regions to Twilio then Submail fallback for SMS', async () => {
    const prisma = createPrismaMock({
      zonesById: {
        'us-zone': {
          id: 'us-zone',
          code: 'US',
          name: 'United States',
          type: ZoneType.COUNTRY,
          parentId: 'na-zone',
        },
        'na-zone': {
          id: 'na-zone',
          code: 'NA',
          name: 'North America',
          type: ZoneType.CONTINENT,
          parentId: null,
        },
      },
    });
    const service = new MessagingRoutingService(prisma as any);

    const route = await service.resolveSmsRoute({
      to: '+14155550123',
      context: { zoneId: 'us-zone' },
    });

    expect(route).toEqual({
      geoBucket: 'other',
      primary: 'twilio',
      fallback: 'submail',
    });
  });

  it('defaults unknown SMS geography to Twilio-first', async () => {
    const prisma = createPrismaMock();
    const service = new MessagingRoutingService(prisma as any);

    const route = await service.resolveSmsRoute({
      to: '+14155550123',
      context: {},
    });

    expect(route).toEqual({
      geoBucket: 'unknown',
      primary: 'twilio',
      fallback: 'submail',
    });
  });

  it('uses +86 heuristic when SMS geography is missing', async () => {
    const prisma = createPrismaMock();
    const service = new MessagingRoutingService(prisma as any);

    const route = await service.resolveSmsRoute({
      to: '+8613000000000',
    });

    expect(route).toEqual({
      geoBucket: 'china',
      primary: 'submail',
    });
  });

  it('looks up email recipient geography by user email before routing', async () => {
    const prisma = createPrismaMock({
      zonesById: {
        'cn-zone': {
          id: 'cn-zone',
          code: 'CN',
          name: 'China',
          type: ZoneType.COUNTRY,
          parentId: 'asia-zone',
        },
        'asia-zone': {
          id: 'asia-zone',
          code: 'AS',
          name: 'Asia',
          type: ZoneType.CONTINENT,
          parentId: null,
        },
      },
      userByEmail: {
        'china-user@example.com': {
          id: 'user-1',
          zoneId: 'cn-zone',
          country: 'China',
          region: null,
        },
      },
    });
    const service = new MessagingRoutingService(prisma as any);

    const route = await service.resolveEmailRoute({
      to: 'china-user@example.com',
    });

    expect(route).toEqual({
      geoBucket: 'china',
      primary: 'submail',
    });
  });
});
