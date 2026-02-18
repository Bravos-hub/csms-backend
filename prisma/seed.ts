import { PrismaClient, SitePurpose, LeaseType, Footfall, ZoneType } from '@prisma/client';
import * as dotenv from 'dotenv';
import * as bcrypt from 'bcrypt';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { URL } from 'url';

// Load environment variables
dotenv.config();

// Debug: Check if DATABASE_URL is loaded
console.log('DATABASE_URL loaded:', !!process.env.DATABASE_URL);

let prisma: PrismaClient;

async function main() {
    // Initialize Prisma client with pg adapter (same as PrismaService)
    const connectionString = process.env.DATABASE_URL;

    if (!connectionString) {
        throw new Error('DATABASE_URL environment variable is not set');
    }

    // Remove sslmode param to avoid overriding the explicit ssl config
    const urlObj = new URL(connectionString);
    urlObj.searchParams.delete('sslmode');

    const pool = new Pool({
        connectionString: urlObj.toString(),
        ssl: { rejectUnauthorized: false }
    });
    const adapter = new PrismaPg(pool);
    prisma = new PrismaClient({ adapter });

    console.log('Seeding database...');

    // 1. Create Super Admin User
    const superAdminPassword = await bcrypt.hash('Password123.', 10);
    const superAdmin = await prisma.user.upsert({
        where: { email: 'delta@evzone.app' },
        update: {
            region: 'Africa',
            status: 'Active'
        },
        create: {
            name: 'Delta Admin',
            email: 'delta@evzone.app',
            role: 'SUPER_ADMIN',
            status: 'Active',
            region: 'Africa',
            passwordHash: superAdminPassword,
            emailVerifiedAt: new Date()
        }
    });
    console.log('Super admin user seeded:', superAdmin.email);

    // 2. Create Mock User
    const mockUserId = 'mock-id';
    const mockUser = await prisma.user.upsert({
        where: { id: mockUserId },
        update: {
            region: 'Africa',
            status: 'Active'
        },
        create: {
            id: mockUserId,
            name: 'Mock User',
            email: 'mock@evzone.app',
            role: 'SITE_OWNER',
            status: 'Active',
            region: 'Africa',
            passwordHash: 'password'
        }
    });
    console.log('Mock user seeded');

    // 2.5 Seed Geographic Zones (Crucial for Analytics)
    console.log('Seeding Geographic Zones...');

    // Continents
    const africa = await prisma.geographicZone.upsert({
        where: { code: 'AF' }, update: {},
        create: { name: 'Africa', code: 'AF', type: ZoneType.CONTINENT }
    });
    const europe = await prisma.geographicZone.upsert({
        where: { code: 'EU' }, update: {},
        create: { name: 'Europe', code: 'EU', type: ZoneType.CONTINENT }
    });

    // Countries
    const uganda = await prisma.geographicZone.upsert({
        where: { code: 'UG' }, update: {},
        create: {
            name: 'Uganda', code: 'UG', type: ZoneType.COUNTRY,
            parentId: africa.id, currency: 'UGX', timezone: 'Africa/Kampala'
        }
    });
    const kenya = await prisma.geographicZone.upsert({
        where: { code: 'KE' }, update: {},
        create: {
            name: 'Kenya', code: 'KE', type: ZoneType.COUNTRY,
            parentId: africa.id, currency: 'KES', timezone: 'Africa/Nairobi'
        }
    });
    const germany = await prisma.geographicZone.upsert({
        where: { code: 'DE' }, update: {},
        create: {
            name: 'Germany', code: 'DE', type: ZoneType.COUNTRY,
            parentId: europe.id, currency: 'EUR', timezone: 'Europe/Berlin'
        }
    });

    // Cities / Regions
    const kampala = await prisma.geographicZone.upsert({
        where: { code: 'UG-102' }, update: {},
        create: { name: 'Kampala', code: 'UG-102', type: ZoneType.ADM1, parentId: uganda.id }
    });
    const nairobi = await prisma.geographicZone.upsert({
        where: { code: 'KE-30' }, update: {},
        create: { name: 'Nairobi', code: 'KE-30', type: ZoneType.ADM1, parentId: kenya.id }
    });
    const berlin = await prisma.geographicZone.upsert({
        where: { code: 'DE-BE' }, update: {},
        create: { name: 'Berlin', code: 'DE-BE', type: ZoneType.ADM1, parentId: germany.id }
    });

    console.log('Geography seeded');

    // 2. Create Site
    const siteId = 'default-site-id';
    const site = await prisma.site.upsert({
        where: { id: siteId },
        update: {},
        create: {
            id: siteId,
            name: 'Main Site',
            city: 'Nairobi',
            address: 'Central Business District',
            powerCapacityKw: 100,
            parkingBays: 10,
            purpose: SitePurpose.COMMERCIAL,
            ownerId: mockUserId,
            leaseDetails: {
                create: {
                    leaseType: LeaseType.REVENUE_SHARE,
                    expectedFootfall: Footfall.HIGH,
                    expectedMonthlyPrice: 500,
                    status: 'ACTIVE'
                }
            }
        }
    });
    console.log('Site seeded');

    // 3. Create Stations (diverse global locations for MapLibre testing)
    const stationsData = [
        { id: 'st-101', name: 'City Mall Roof', latitude: 0.3476, longitude: 32.5825, address: 'Plot 7 Jinja Rd', status: 'ACTIVE', zoneId: kampala.id },
        { id: 'st-102', name: 'Tech Park A', latitude: 0.0630, longitude: 32.4631, address: 'Block 4', status: 'PAUSED', zoneId: uganda.id },
        { id: 'st-103', name: 'Airport East', latitude: -1.2864, longitude: 36.8172, address: 'Terminal C', status: 'ACTIVE', zoneId: nairobi.id },
        { id: 'st-104', name: 'Central Hub', latitude: -6.7924, longitude: 39.2083, address: 'Industrial Area', status: 'ACTIVE', zoneId: africa.id }, // Dar es Salaam
        { id: 'st-105', name: 'Business Park', latitude: 52.5200, longitude: 13.4050, address: 'Building 5', status: 'MAINTENANCE', zoneId: berlin.id },
        { id: 'st-106', name: 'Kampala North', latitude: 0.3800, longitude: 32.5600, address: 'Kawempe', status: 'ACTIVE', zoneId: kampala.id },
        { id: 'st-107', name: 'Nairobi West', latitude: -1.2600, longitude: 36.8000, address: 'Westlands', status: 'OFFLINE', zoneId: nairobi.id },
        { id: 'st-108', name: 'Entebbe Pier', latitude: 0.0500, longitude: 32.4500, address: 'Lakeside', status: 'ACTIVE', zoneId: uganda.id },
        { id: 'st-109', name: 'Berlin Hauptbahnhof', latitude: 52.5250, longitude: 13.3690, address: 'Europaplatz 1', status: 'ACTIVE', zoneId: berlin.id },
        { id: 'st-110', name: 'Mombasa Port', latitude: -4.0435, longitude: 39.6682, address: 'Kilindini', status: 'ACTIVE', zoneId: kenya.id },
        // Large cluster in Kampala
        ...Array.from({ length: 15 }).map((_, i) => ({
            id: `st-cluster-kampala-${i}`,
            name: `Kampala CBD ${i + 1}`,
            latitude: 0.31 + (Math.random() * 0.02 - 0.01),
            longitude: 32.58 + (Math.random() * 0.02 - 0.01),
            address: `CBD Street ${i + 1}`,
            status: Math.random() > 0.8 ? 'OFFLINE' : 'ACTIVE',
            zoneId: kampala.id
        }))
    ];

    for (const s of stationsData) {
        await prisma.station.upsert({
            where: { id: s.id },
            update: {
                name: s.name,
                latitude: s.latitude,
                longitude: s.longitude,
                address: s.address,
                status: s.status,
                siteId: siteId,
                zoneId: s.zoneId
            },
            create: {
                id: s.id,
                name: s.name,
                latitude: s.latitude,
                longitude: s.longitude,
                address: s.address,
                status: s.status,
                siteId: siteId, // Link to main site
                zoneId: s.zoneId
            }
        });
    }
    console.log(`${stationsData.length} stations seeded`);

    // 4. Create Site for the station (using the same ID the frontend is requesting)
    const frontendSiteId = '0b0817eb-fc2a-413c-94f7-c8826ad57967';
    const frontendSite = await prisma.site.upsert({
        where: { id: frontendSiteId },
        update: {},
        create: {
            id: frontendSiteId,
            name: 'CBD Charging Site',
            city: 'Nairobi',
            address: 'Central Business District, Nairobi',
            powerCapacityKw: 150,
            parkingBays: 20,
            purpose: SitePurpose.COMMERCIAL,
            ownerId: mockUserId,
            leaseDetails: {
                create: {
                    leaseType: LeaseType.REVENUE_SHARE,
                    expectedFootfall: Footfall.VERY_HIGH,
                    expectedMonthlyPrice: 1000,
                    status: 'ACTIVE'
                }
            }
        }
    });
    console.log('Frontend site seeded');

    // 5. Create Sample Documents for the frontend site
    await prisma.siteDocument.upsert({
        where: { id: 'doc-1' },
        update: {},
        create: {
            id: 'doc-1',
            siteId: frontendSiteId,
            name: 'Lease Agreement 2026',
            type: 'lease_agreement',
            fileUrl: 'https://example.com/documents/lease-agreement-2026.pdf',
            fileSize: 245760,
            mimeType: 'application/pdf',
            uploadedBy: mockUserId,
            description: 'Commercial lease agreement for the CBD site'
        }
    });

    await prisma.siteDocument.upsert({
        where: { id: 'doc-2' },
        update: {},
        create: {
            id: 'doc-2',
            siteId: frontendSiteId,
            name: 'Electrical Permit',
            type: 'permit',
            fileUrl: 'https://example.com/documents/electrical-permit.pdf',
            fileSize: 102400,
            mimeType: 'application/pdf',
            uploadedBy: mockUserId,
            description: 'Approved electrical installation permit'
        }
    });

    await prisma.siteDocument.upsert({
        where: { id: 'doc-3' },
        update: {},
        create: {
            id: 'doc-3',
            siteId: frontendSiteId,
            name: 'Insurance Certificate',
            type: 'insurance',
            fileUrl: 'https://example.com/documents/insurance-cert.pdf',
            fileSize: 153600,
            mimeType: 'application/pdf',
            uploadedBy: mockUserId,
            description: 'Liability insurance certificate'
        }
    });

    console.log('Sample documents seeded');

    // 6. Create Sample Tenant Applications
    await prisma.tenantApplication.upsert({
        where: { id: 'app-1' },
        update: {},
        create: {
            id: 'app-1',
            applicantId: mockUserId,
            organizationName: 'GreenCharge Solutions Ltd',
            businessRegistrationNumber: 'BR-2024-12345',
            taxComplianceNumber: 'TAX-98765',
            contactPersonName: 'John Doe',
            contactEmail: 'john.doe@greencharge.com',
            contactPhone: '+254700123456',
            physicalAddress: 'Westlands, Nairobi',
            companyWebsite: 'https://greencharge.com',
            yearsInEVBusiness: '3-5',
            existingStationsOperated: 5,
            siteId: frontendSiteId,
            preferredLeaseModel: 'Revenue Share',
            businessPlanSummary: 'We plan to install 10 fast chargers to serve the CBD area with 24/7 operations.',
            sustainabilityCommitments: 'All energy will be sourced from renewable sources',
            additionalServices: JSON.stringify(['EV Maintenance', 'Retail']),
            estimatedStartDate: '2026-03-01',
            status: 'PENDING_REVIEW',


            message: 'We are excited to partner with you to expand EV infrastructure'
        }
    });

    await prisma.tenantApplication.upsert({
        where: { id: 'app-2' },
        update: {},
        create: {
            id: 'app-2',
            applicantId: mockUserId,
            organizationName: 'PowerGrid EV Operations',
            businessRegistrationNumber: 'BR-2023-54321',
            contactPersonName: 'Jane Smith',
            contactEmail: 'jane.smith@powergrid.com',
            contactPhone: '+254711234567',
            physicalAddress: 'Upperhill, Nairobi',
            yearsInEVBusiness: '5+',
            existingStationsOperated: 15,
            siteId: frontendSiteId,
            preferredLeaseModel: 'Fixed Rent',
            businessPlanSummary: 'Operate premium charging facility with customer lounge',
            proposedRent: 1500,
            proposedTerm: 36,
            numberOfChargingPoints: 12,
            status: 'APPROVED',

            responseMessage: 'We are pleased to approve your application. Please review the proposed terms.',
            respondedAt: new Date('2026-01-15')
        }
    });

    console.log('Sample tenant applications seeded');

    // 6. Seed Subscription Plans
    console.log('Seeding subscription plans...');

    // Station Owner Plans
    const ownerStarter = await prisma.subscriptionPlan.upsert({
        where: { code: 'owner-starter' },
        update: {},
        create: {
            code: 'owner-starter',
            name: 'Starter',
            description: 'Perfect for getting started with your first charging station',
            role: 'STATION_OWNER',
            price: 0,
            currency: 'UGX',
            billingCycle: 'MONTHLY',
            isActive: true,
            isPublic: true,
            isPopular: false,
            features: {
                create: [
                    { featureKey: 'CAPACITY', featureValue: 'Up to 5 chargers', order: 1 },
                    { featureKey: 'ANALYTICS', featureValue: 'Basic reporting', order: 2 },
                    { featureKey: 'SUPPORT', featureValue: 'Email support', order: 3 },
                ]
            },
            permissions: {
                create: [
                    { resource: 'stations', action: 'read', description: 'scope: own, limit: 5' },
                    { resource: 'stations', action: 'create', description: 'scope: own, limit: 5' },
                    { resource: 'analytics', action: 'read', description: 'scope: basic' },
                    { resource: 'billing', action: 'read', description: 'scope: own' },
                ]
            }
        }
    });

    const ownerGrowth = await prisma.subscriptionPlan.upsert({
        where: { code: 'owner-growth' },
        update: {},
        create: {
            code: 'owner-growth',
            name: 'Growth',
            description: 'Scale your charging network with advanced features',
            role: 'STATION_OWNER',
            price: 49000,
            currency: 'UGX',
            billingCycle: 'MONTHLY',
            isActive: true,
            isPublic: true,
            isPopular: true,
            features: {
                create: [
                    { featureKey: 'CAPACITY', featureValue: 'Up to 25 chargers', order: 1 },
                    { featureKey: 'FEATURES', featureValue: 'Smart charging', order: 2 },
                    { featureKey: 'SUPPORT', featureValue: 'Priority support', order: 3 },
                    { featureKey: 'ANALYTICS', featureValue: 'Advanced analytics', order: 4 },
                ]
            },
            permissions: {
                create: [
                    { resource: 'stations', action: 'read', description: 'scope: own, limit: 25' },
                    { resource: 'stations', action: 'create', description: 'scope: own, limit: 25' },
                    { resource: 'stations', action: 'update', description: 'scope: own' },
                    { resource: 'analytics', action: 'read', description: 'scope: advanced' },
                    { resource: 'billing', action: 'read', description: 'scope: own' },
                    { resource: 'billing', action: 'update', description: 'scope: own' },
                    { resource: 'tou', action: 'manage', description: 'scope: own' },
                ]
            }
        }
    });

    const ownerEnterprise = await prisma.subscriptionPlan.upsert({
        where: { code: 'owner-enterprise' },
        update: {},
        create: {
            code: 'owner-enterprise',
            name: 'Enterprise',
            description: 'Unlimited scale with dedicated support',
            role: 'STATION_OWNER',
            price: 0, // Custom pricing
            currency: 'UGX',
            billingCycle: 'MONTHLY',
            isActive: true,
            isPublic: true,
            isPopular: false,
            features: {
                create: [
                    { featureKey: 'CAPACITY', featureValue: 'Unlimited chargers', order: 1 },
                    { featureKey: 'SUPPORT', featureValue: 'SLA guarantees', order: 2 },
                    { featureKey: 'SUPPORT', featureValue: 'Dedicated account manager', order: 3 },
                    { featureKey: 'FEATURES', featureValue: 'OCPI Roaming', order: 4 },
                    { featureKey: 'FEATURES', featureValue: 'Custom integrations', order: 5 },
                ]
            },
            permissions: {
                create: [
                    { resource: 'stations', action: 'read', description: 'scope: own' },
                    { resource: 'stations', action: 'create', description: 'scope: own' },
                    { resource: 'stations', action: 'update', description: 'scope: own' },
                    { resource: 'stations', action: 'delete', description: 'scope: own' },
                    { resource: 'analytics', action: 'read', description: 'scope: all' },
                    { resource: 'billing', action: 'manage', description: 'scope: own' },
                    { resource: 'roaming', action: 'manage', description: 'scope: own' },
                    { resource: 'settlement', action: 'manage', description: 'scope: own' },
                    { resource: 'api', action: 'access', description: 'scope: own' },
                ]
            }
        }
    });

    // Operator Plans
    const operatorBasic = await prisma.subscriptionPlan.upsert({
        where: { code: 'op-basic' },
        update: {},
        create: {
            code: 'op-basic',
            name: 'Basic',
            description: 'Essential tools for station operations',
            role: 'STATION_OPERATOR',
            price: 0,
            currency: 'UGX',
            billingCycle: 'MONTHLY',
            isActive: true,
            isPublic: true,
            features: {
                create: [
                    { featureKey: 'CAPACITY', featureValue: 'Up to 3 stations', order: 1 },
                    { featureKey: 'FEATURES', featureValue: 'Basic dashboard', order: 2 },
                    { featureKey: 'SUPPORT', featureValue: 'Email support', order: 3 },
                ]
            },
            permissions: {
                create: [
                    { resource: 'stations', action: 'read', description: 'scope: assigned, limit: 3' },
                    { resource: 'sessions', action: 'read', description: 'scope: assigned' },
                    { resource: 'incidents', action: 'create', description: 'scope: assigned' },
                ]
            }
        }
    });

    const operatorPlus = await prisma.subscriptionPlan.upsert({
        where: { code: 'op-plus' },
        update: {},
        create: {
            code: 'op-plus',
            name: 'Plus',
            description: 'Advanced operations management',
            role: 'STATION_OPERATOR',
            price: 29000,
            currency: 'UGX',
            billingCycle: 'MONTHLY',
            isActive: true,
            isPublic: true,
            isPopular: true,
            features: {
                create: [
                    { featureKey: 'CAPACITY', featureValue: 'Unlimited stations', order: 1 },
                    { featureKey: 'FEATURES', featureValue: 'Team management', order: 2 },
                    { featureKey: 'ANALYTICS', featureValue: 'Advanced analytics', order: 3 },
                    { featureKey: 'SUPPORT', featureValue: 'Priority support', order: 4 },
                ]
            },
            permissions: {
                create: [
                    { resource: 'stations', action: 'read', description: 'scope: assigned' },
                    { resource: 'stations', action: 'update', description: 'scope: assigned' },
                    { resource: 'sessions', action: 'read', description: 'scope: assigned' },
                    { resource: 'incidents', action: 'manage', description: 'scope: assigned' },
                    { resource: 'analytics', action: 'read', description: 'scope: advanced' },
                    { resource: 'team', action: 'manage', description: 'scope: own' },
                ]
            }
        }
    });

    // Technician Plans
    const techFree = await prisma.subscriptionPlan.upsert({
        where: { code: 'tech-free' },
        update: {},
        create: {
            code: 'tech-free',
            name: 'Freelance',
            description: 'Access the public marketplace',
            role: 'TECHNICIAN_ORG',
            price: 0,
            currency: 'UGX',
            billingCycle: 'MONTHLY',
            isActive: true,
            isPublic: true,
            features: {
                create: [
                    { featureKey: 'FEATURES', featureValue: 'Public marketplace', order: 1 },
                    { featureKey: 'FEATURES', featureValue: 'Job notifications', order: 2 },
                ]
            },
            permissions: {
                create: [
                    { resource: 'jobs', action: 'read', description: 'scope: public' },
                    { resource: 'jobs', action: 'apply', description: 'scope: public' },
                ]
            }
        }
    });

    const techPro = await prisma.subscriptionPlan.upsert({
        where: { code: 'tech-pro' },
        update: {},
        create: {
            code: 'tech-pro',
            name: 'Pro',
            description: 'Priority job matching and certification showcase',
            role: 'TECHNICIAN_ORG',
            price: 19000,
            currency: 'UGX',
            billingCycle: 'MONTHLY',
            isActive: true,
            isPublic: true,
            isPopular: true,
            features: {
                create: [
                    { featureKey: 'FEATURES', featureValue: 'Priority job matching', order: 1 },
                    { featureKey: 'FEATURES', featureValue: 'Certification showcase', order: 2 },
                    { featureKey: 'ANALYTICS', featureValue: 'Analytics dashboard', order: 3 },
                ]
            },
            permissions: {
                create: [
                    { resource: 'jobs', action: 'read', description: 'scope: all' },
                    { resource: 'jobs', action: 'apply', description: 'scope: priority' },
                    { resource: 'certifications', action: 'manage', description: 'scope: own' },
                    { resource: 'analytics', action: 'read', description: 'scope: own' },
                ]
            }
        }
    });

    // Site Owner Plans
    const siteBasic = await prisma.subscriptionPlan.upsert({
        where: { code: 'so-basic' },
        update: {},
        create: {
            code: 'so-basic',
            name: 'Basic',
            description: 'List your sites for charging stations',
            role: 'SITE_OWNER',
            price: 0,
            currency: 'UGX',
            billingCycle: 'MONTHLY',
            isActive: true,
            isPublic: true,
            features: {
                create: [
                    { featureKey: 'CAPACITY', featureValue: 'List up to 3 sites', order: 1 },
                    { featureKey: 'FEATURES', featureValue: 'Standard listing', order: 2 },
                ]
            },
            permissions: {
                create: [
                    { resource: 'sites', action: 'read', description: 'scope: own, limit: 3' },
                    { resource: 'sites', action: 'create', description: 'scope: own, limit: 3' },
                    { resource: 'applications', action: 'read', description: 'scope: own' },
                ]
            }
        }
    });

    const sitePro = await prisma.subscriptionPlan.upsert({
        where: { code: 'so-pro' },
        update: {},
        create: {
            code: 'so-pro',
            name: 'Pro',
            description: 'Maximize your site revenue potential',
            role: 'SITE_OWNER',
            price: 39000,
            currency: 'UGX',
            billingCycle: 'MONTHLY',
            isActive: true,
            isPublic: true,
            isPopular: true,
            features: {
                create: [
                    { featureKey: 'CAPACITY', featureValue: 'Unlimited sites', order: 1 },
                    { featureKey: 'FEATURES', featureValue: 'Featured listings', order: 2 },
                    { featureKey: 'ANALYTICS', featureValue: 'Revenue analytics', order: 3 },
                    { featureKey: 'SUPPORT', featureValue: 'Priority support', order: 4 },
                ]
            },
            permissions: {
                create: [
                    { resource: 'sites', action: 'read', description: 'scope: own' },
                    { resource: 'sites', action: 'create', description: 'scope: own' },
                    { resource: 'sites', action: 'update', description: 'scope: own' },
                    { resource: 'applications', action: 'manage', description: 'scope: own' },
                    { resource: 'analytics', action: 'read', description: 'scope: own' },
                    { resource: 'featured', action: 'access', description: 'scope: own' },
                ]
            }
        }
    });

    console.log('Subscription plans seeded');

    // 7. Seed provider ecosystem (marketplace + governance)
    console.log('Seeding provider ecosystem...');

    const ownerOrgA = await prisma.organization.upsert({
        where: { id: 'org-owner-a' },
        update: { name: 'Green Route Owners Ltd' },
        create: {
            id: 'org-owner-a',
            name: 'Green Route Owners Ltd',
            type: 'COMPANY',
            city: 'Kampala',
        },
    });

    const ownerOrgB = await prisma.organization.upsert({
        where: { id: 'org-owner-b' },
        update: { name: 'Metro Fleet Energy Ltd' },
        create: {
            id: 'org-owner-b',
            name: 'Metro Fleet Energy Ltd',
            type: 'COMPANY',
            city: 'Nairobi',
        },
    });

    const providerOrg1 = await prisma.organization.upsert({
        where: { id: 'org-provider-1' },
        update: { name: 'VoltSwap Networks' },
        create: {
            id: 'org-provider-1',
            name: 'VoltSwap Networks',
            type: 'COMPANY',
            city: 'Kampala',
        },
    });

    const providerOrg2 = await prisma.organization.upsert({
        where: { id: 'org-provider-2' },
        update: { name: 'BatteryLoop Africa' },
        create: {
            id: 'org-provider-2',
            name: 'BatteryLoop Africa',
            type: 'COMPANY',
            city: 'Nairobi',
        },
    });

    const providerOrg3 = await prisma.organization.upsert({
        where: { id: 'org-provider-3' },
        update: { name: 'SwapLink Transit' },
        create: {
            id: 'org-provider-3',
            name: 'SwapLink Transit',
            type: 'COMPANY',
            city: 'Berlin',
        },
    });

    const ownerPassword = await bcrypt.hash('Password123.', 10);
    await prisma.user.upsert({
        where: { email: 'owner-a@evzone.app' },
        update: {
            role: 'STATION_OWNER',
            status: 'Active',
            ownerCapability: 'SWAP',
            organizationId: ownerOrgA.id,
            region: 'UGANDA',
            emailVerifiedAt: new Date(),
        },
        create: {
            name: 'Owner A',
            email: 'owner-a@evzone.app',
            role: 'STATION_OWNER',
            status: 'Active',
            ownerCapability: 'SWAP',
            organizationId: ownerOrgA.id,
            region: 'UGANDA',
            passwordHash: ownerPassword,
            emailVerifiedAt: new Date(),
        },
    });

    await prisma.user.upsert({
        where: { email: 'owner-b@evzone.app' },
        update: {
            role: 'STATION_OWNER',
            status: 'Active',
            ownerCapability: 'BOTH',
            organizationId: ownerOrgB.id,
            region: 'KENYA',
            emailVerifiedAt: new Date(),
        },
        create: {
            name: 'Owner B',
            email: 'owner-b@evzone.app',
            role: 'STATION_OWNER',
            status: 'Active',
            ownerCapability: 'BOTH',
            organizationId: ownerOrgB.id,
            region: 'KENYA',
            passwordHash: ownerPassword,
            emailVerifiedAt: new Date(),
        },
    });

    const provider1 = await prisma.swapProvider.upsert({
        where: { id: 'provider-approved-1' },
        update: {
            name: 'VoltSwap Networks',
            region: 'UGANDA',
            standard: 'Gogoro G2',
            batteriesSupported: ['GOGORO_G2', 'GOGORO_G2_PLUS'],
            status: 'APPROVED',
            stationCount: 18,
            organizationId: providerOrg1.id,
            contactEmail: 'ops@voltswap.example',
            contactPhone: '+256700000001',
            website: 'https://voltswap.example',
        },
        create: {
            id: 'provider-approved-1',
            name: 'VoltSwap Networks',
            legalName: 'VoltSwap Networks Ltd',
            registrationNumber: 'REG-VSN-1001',
            taxId: 'TIN-VSN-7788',
            contactEmail: 'ops@voltswap.example',
            contactPhone: '+256700000001',
            region: 'UGANDA',
            regions: ['UGANDA', 'KENYA'],
            countries: ['UG', 'KE'],
            organizationId: providerOrg1.id,
            standard: 'Gogoro G2',
            batteriesSupported: ['GOGORO_G2', 'GOGORO_G2_PLUS'],
            supportedStationTypes: ['SWAP'],
            protocolCapabilities: ['OCPI', 'BATCH_SETTLEMENT'],
            feeModel: 'PER_SWAP',
            settlementTerms: 'T+7',
            stationCount: 18,
            website: 'https://voltswap.example',
            status: 'APPROVED',
            approvedAt: new Date(),
            requiredDocuments: [
                'INCORPORATION',
                'TAX_COMPLIANCE',
                'INSURANCE',
                'TECHNICAL_CONFORMANCE',
            ],
            partnerSince: new Date('2025-11-10T00:00:00.000Z'),
        },
    });

    const provider2 = await prisma.swapProvider.upsert({
        where: { id: 'provider-approved-2' },
        update: {
            name: 'BatteryLoop Africa',
            region: 'KENYA',
            standard: 'Universal',
            batteriesSupported: ['UNIVERSAL_2W', 'UNIVERSAL_3W'],
            status: 'APPROVED',
            stationCount: 24,
            organizationId: providerOrg2.id,
            contactEmail: 'operations@batteryloop.example',
            contactPhone: '+254700000002',
            website: 'https://batteryloop.example',
        },
        create: {
            id: 'provider-approved-2',
            name: 'BatteryLoop Africa',
            legalName: 'BatteryLoop Africa Ltd',
            registrationNumber: 'REG-BLA-2002',
            taxId: 'TIN-BLA-8899',
            contactEmail: 'operations@batteryloop.example',
            contactPhone: '+254700000002',
            region: 'KENYA',
            regions: ['KENYA', 'UGANDA', 'TANZANIA'],
            countries: ['KE', 'UG', 'TZ'],
            organizationId: providerOrg2.id,
            standard: 'Universal',
            batteriesSupported: ['UNIVERSAL_2W', 'UNIVERSAL_3W'],
            supportedStationTypes: ['SWAP', 'BOTH'],
            protocolCapabilities: ['OCPI', 'REALTIME_STATUS'],
            feeModel: 'REVENUE_SHARE',
            settlementTerms: 'T+14',
            stationCount: 24,
            website: 'https://batteryloop.example',
            status: 'APPROVED',
            approvedAt: new Date(),
            requiredDocuments: [
                'INCORPORATION',
                'TAX_COMPLIANCE',
                'INSURANCE',
                'BATTERY_SAFETY_CERTIFICATION',
            ],
            partnerSince: new Date('2025-10-02T00:00:00.000Z'),
        },
    });

    const provider3 = await prisma.swapProvider.upsert({
        where: { id: 'provider-pending-1' },
        update: {
            name: 'SwapLink Transit',
            region: 'GERMANY',
            standard: 'NIO BaaS',
            batteriesSupported: ['NIO_BAAS'],
            status: 'PENDING_REVIEW',
            stationCount: 5,
            organizationId: providerOrg3.id,
            contactEmail: 'hello@swaplink.example',
            contactPhone: '+49300000003',
            website: 'https://swaplink.example',
        },
        create: {
            id: 'provider-pending-1',
            name: 'SwapLink Transit',
            legalName: 'SwapLink Transit GmbH',
            registrationNumber: 'REG-SLT-3003',
            taxId: 'TIN-SLT-9911',
            contactEmail: 'hello@swaplink.example',
            contactPhone: '+49300000003',
            region: 'GERMANY',
            regions: ['GERMANY'],
            countries: ['DE'],
            organizationId: providerOrg3.id,
            standard: 'NIO BaaS',
            batteriesSupported: ['NIO_BAAS'],
            supportedStationTypes: ['SWAP'],
            protocolCapabilities: ['OCPI'],
            feeModel: 'PER_SWAP',
            settlementTerms: 'T+30',
            stationCount: 5,
            website: 'https://swaplink.example',
            status: 'PENDING_REVIEW',
            requiredDocuments: ['INCORPORATION', 'TAX_COMPLIANCE', 'INSURANCE'],
            partnerSince: new Date('2026-01-01T00:00:00.000Z'),
        },
    });

    await prisma.user.upsert({
        where: { email: 'provider-admin-1@evzone.app' },
        update: {
            role: 'SWAP_PROVIDER_ADMIN',
            status: 'Active',
            organizationId: providerOrg1.id,
            providerId: provider1.id,
            region: 'UGANDA',
            emailVerifiedAt: new Date(),
        },
        create: {
            name: 'Provider Admin 1',
            email: 'provider-admin-1@evzone.app',
            role: 'SWAP_PROVIDER_ADMIN',
            status: 'Active',
            organizationId: providerOrg1.id,
            providerId: provider1.id,
            region: 'UGANDA',
            passwordHash: ownerPassword,
            emailVerifiedAt: new Date(),
        },
    });

    await prisma.user.upsert({
        where: { email: 'provider-operator-1@evzone.app' },
        update: {
            role: 'SWAP_PROVIDER_OPERATOR',
            status: 'Active',
            organizationId: providerOrg2.id,
            providerId: provider2.id,
            region: 'KENYA',
            emailVerifiedAt: new Date(),
        },
        create: {
            name: 'Provider Operator 1',
            email: 'provider-operator-1@evzone.app',
            role: 'SWAP_PROVIDER_OPERATOR',
            status: 'Active',
            organizationId: providerOrg2.id,
            providerId: provider2.id,
            region: 'KENYA',
            passwordHash: ownerPassword,
            emailVerifiedAt: new Date(),
        },
    });

    await prisma.providerRelationship.upsert({
        where: { id: 'relationship-requested-1' },
        update: {
            providerId: provider2.id,
            ownerOrgId: ownerOrgA.id,
            status: 'REQUESTED',
            requestedBy: mockUserId,
            notes: 'Initial request from Owner A',
        },
        create: {
            id: 'relationship-requested-1',
            providerId: provider2.id,
            ownerOrgId: ownerOrgA.id,
            status: 'REQUESTED',
            requestedBy: mockUserId,
            notes: 'Initial request from Owner A',
        },
    });

    const relationshipDocsPending = await prisma.providerRelationship.upsert({
        where: { id: 'relationship-docs-pending-1' },
        update: {
            providerId: provider1.id,
            ownerOrgId: ownerOrgA.id,
            status: 'DOCS_PENDING',
            requestedBy: mockUserId,
            providerRespondedAt: new Date('2026-01-15T00:00:00.000Z'),
            notes: 'Awaiting compliance documents',
        },
        create: {
            id: 'relationship-docs-pending-1',
            providerId: provider1.id,
            ownerOrgId: ownerOrgA.id,
            status: 'DOCS_PENDING',
            requestedBy: mockUserId,
            providerRespondedAt: new Date('2026-01-15T00:00:00.000Z'),
            notes: 'Awaiting compliance documents',
        },
    });

    const relationshipActive = await prisma.providerRelationship.upsert({
        where: { id: 'relationship-active-1' },
        update: {
            providerId: provider2.id,
            ownerOrgId: ownerOrgB.id,
            status: 'ACTIVE',
            requestedBy: mockUserId,
            providerRespondedAt: new Date('2025-12-01T00:00:00.000Z'),
            adminApprovedAt: new Date('2025-12-12T00:00:00.000Z'),
            notes: 'Active partnership',
        },
        create: {
            id: 'relationship-active-1',
            providerId: provider2.id,
            ownerOrgId: ownerOrgB.id,
            status: 'ACTIVE',
            requestedBy: mockUserId,
            providerRespondedAt: new Date('2025-12-01T00:00:00.000Z'),
            adminApprovedAt: new Date('2025-12-12T00:00:00.000Z'),
            notes: 'Active partnership',
        },
    });

    await prisma.providerRelationship.upsert({
        where: { id: 'relationship-terminated-1' },
        update: {
            providerId: provider1.id,
            ownerOrgId: ownerOrgB.id,
            status: 'TERMINATED',
            requestedBy: mockUserId,
            providerRespondedAt: new Date('2025-11-05T00:00:00.000Z'),
            notes: 'Terminated after pilot',
        },
        create: {
            id: 'relationship-terminated-1',
            providerId: provider1.id,
            ownerOrgId: ownerOrgB.id,
            status: 'TERMINATED',
            requestedBy: mockUserId,
            providerRespondedAt: new Date('2025-11-05T00:00:00.000Z'),
            notes: 'Terminated after pilot',
        },
    });

    await prisma.providerDocument.upsert({
        where: { id: 'provider-doc-1' },
        update: {
            providerId: provider1.id,
            relationshipId: relationshipDocsPending.id,
            ownerOrgId: ownerOrgA.id,
            type: 'TECHNICAL_CONFORMANCE',
            name: 'Technical Conformance Pack',
            fileUrl: 'https://example.com/provider-docs/technical-conformance-pack.pdf',
            status: 'PENDING',
            uploadedBy: mockUserId,
        },
        create: {
            id: 'provider-doc-1',
            providerId: provider1.id,
            relationshipId: relationshipDocsPending.id,
            ownerOrgId: ownerOrgA.id,
            type: 'TECHNICAL_CONFORMANCE',
            name: 'Technical Conformance Pack',
            fileUrl: 'https://example.com/provider-docs/technical-conformance-pack.pdf',
            status: 'PENDING',
            uploadedBy: mockUserId,
        },
    });

    await prisma.providerDocument.upsert({
        where: { id: 'provider-doc-2' },
        update: {
            providerId: provider2.id,
            relationshipId: relationshipActive.id,
            ownerOrgId: ownerOrgB.id,
            type: 'INSURANCE',
            name: 'Insurance Certificate 2026',
            fileUrl: 'https://example.com/provider-docs/insurance-certificate-2026.pdf',
            status: 'APPROVED',
            uploadedBy: mockUserId,
        },
        create: {
            id: 'provider-doc-2',
            providerId: provider2.id,
            relationshipId: relationshipActive.id,
            ownerOrgId: ownerOrgB.id,
            type: 'INSURANCE',
            name: 'Insurance Certificate 2026',
            fileUrl: 'https://example.com/provider-docs/insurance-certificate-2026.pdf',
            status: 'APPROVED',
            uploadedBy: mockUserId,
        },
    });

    await prisma.providerSettlementEntry.upsert({
        where: { id: 'provider-settlement-1' },
        update: {
            relationshipId: relationshipActive.id,
            providerId: provider2.id,
            ownerOrgId: ownerOrgB.id,
            amount: 1200,
            providerFee: 120,
            platformFee: 80,
            adjustment: 0,
            net: 1000,
            currency: 'USD',
            status: 'PAID',
        },
        create: {
            id: 'provider-settlement-1',
            relationshipId: relationshipActive.id,
            providerId: provider2.id,
            ownerOrgId: ownerOrgB.id,
            amount: 1200,
            providerFee: 120,
            platformFee: 80,
            adjustment: 0,
            net: 1000,
            currency: 'USD',
            status: 'PAID',
        },
    });

    await prisma.providerSettlementEntry.upsert({
        where: { id: 'provider-settlement-2' },
        update: {
            relationshipId: relationshipActive.id,
            providerId: provider2.id,
            ownerOrgId: ownerOrgB.id,
            amount: 780,
            providerFee: 78,
            platformFee: 52,
            adjustment: -10,
            net: 640,
            currency: 'USD',
            status: 'PENDING',
        },
        create: {
            id: 'provider-settlement-2',
            relationshipId: relationshipActive.id,
            providerId: provider2.id,
            ownerOrgId: ownerOrgB.id,
            amount: 780,
            providerFee: 78,
            platformFee: 52,
            adjustment: -10,
            net: 640,
            currency: 'USD',
            status: 'PENDING',
        },
    });

    await prisma.providerSettlementEntry.upsert({
        where: { id: 'provider-settlement-3' },
        update: {
            relationshipId: relationshipActive.id,
            providerId: provider2.id,
            ownerOrgId: ownerOrgB.id,
            amount: 450,
            providerFee: 45,
            platformFee: 30,
            adjustment: 15,
            net: 390,
            currency: 'USD',
            status: 'DISPUTED',
        },
        create: {
            id: 'provider-settlement-3',
            relationshipId: relationshipActive.id,
            providerId: provider2.id,
            ownerOrgId: ownerOrgB.id,
            amount: 450,
            providerFee: 45,
            platformFee: 30,
            adjustment: 15,
            net: 390,
            currency: 'USD',
            status: 'DISPUTED',
        },
    });

    console.log('Provider ecosystem seeded');

    console.log('Seeding complete!');

}

main()
    .catch((e) => {
        console.error('Seeding failed:', e instanceof Error ? e.message : 'Unknown error');
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
