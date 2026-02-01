import { PrismaClient, SitePurpose, LeaseType, Footfall } from '@prisma/client';
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
        update: {},
        create: {
            name: 'Delta Admin',
            email: 'delta@evzone.app',
            role: 'SUPER_ADMIN',
            status: 'Active',
            passwordHash: superAdminPassword,
            emailVerifiedAt: new Date()
        }
    });
    console.log('Super admin user seeded:', superAdmin.email);

    // 2. Create Mock User
    const mockUserId = 'mock-id';
    const mockUser = await prisma.user.upsert({
        where: { id: mockUserId },
        update: {},
        create: {
            id: mockUserId,
            name: 'Mock User',
            email: 'mock@evzone.app',
            role: 'SITE_OWNER',
            status: 'Active',
            passwordHash: 'password'
        }
    });
    console.log('Mock user seeded');

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
        { id: 'st-101', name: 'City Mall Roof', latitude: 0.3476, longitude: 32.5825, address: 'Plot 7 Jinja Rd', status: 'ACTIVE' },
        { id: 'st-102', name: 'Tech Park A', latitude: 0.0630, longitude: 32.4631, address: 'Block 4', status: 'PAUSED' },
        { id: 'st-103', name: 'Airport East', latitude: -1.2864, longitude: 36.8172, address: 'Terminal C', status: 'ACTIVE' },
        { id: 'st-104', name: 'Central Hub', latitude: -6.7924, longitude: 39.2083, address: 'Industrial Area', status: 'ACTIVE' },
        { id: 'st-105', name: 'Business Park', latitude: 52.5200, longitude: 13.4050, address: 'Building 5', status: 'MAINTENANCE' },
        { id: 'st-106', name: 'Kampala North', latitude: 0.3800, longitude: 32.5600, address: 'Kawempe', status: 'ACTIVE' },
        { id: 'st-107', name: 'Nairobi West', latitude: -1.2600, longitude: 36.8000, address: 'Westlands', status: 'OFFLINE' },
        { id: 'st-108', name: 'Entebbe Pier', latitude: 0.0500, longitude: 32.4500, address: 'Lakeside', status: 'ACTIVE' },
        { id: 'st-109', name: 'Berlin Hauptbahnhof', latitude: 52.5250, longitude: 13.3690, address: 'Europaplatz 1', status: 'ACTIVE' },
        { id: 'st-110', name: 'Mombasa Port', latitude: -4.0435, longitude: 39.6682, address: 'Kilindini', status: 'ACTIVE' },
        // Large cluster in Kampala
        ...Array.from({ length: 15 }).map((_, i) => ({
            id: `st-cluster-kampala-${i}`,
            name: `Kampala CBD ${i + 1}`,
            latitude: 0.31 + (Math.random() * 0.02 - 0.01),
            longitude: 32.58 + (Math.random() * 0.02 - 0.01),
            address: `CBD Street ${i + 1}`,
            status: Math.random() > 0.8 ? 'OFFLINE' : 'ACTIVE'
        }))
    ];

    for (const s of stationsData) {
        await prisma.station.upsert({
            where: { id: s.id },
            update: {},
            create: {
                id: s.id,
                name: s.name,
                latitude: s.latitude,
                longitude: s.longitude,
                address: s.address,
                status: s.status,
                siteId: siteId // Link to main site
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
            limits: { maxStations: 5, maxChargers: 25, maxUsers: 3 },
            features: {
                create: [
                    { name: 'Up to 5 chargers', category: 'CAPACITY', order: 1 },
                    { name: 'Basic reporting', category: 'ANALYTICS', order: 2 },
                    { name: 'Email support', category: 'SUPPORT', order: 3 },
                ]
            },
            permissions: {
                create: [
                    { resource: 'stations', action: 'read', scope: 'own', limit: 5 },
                    { resource: 'stations', action: 'create', scope: 'own', limit: 5 },
                    { resource: 'analytics', action: 'read', scope: 'basic' },
                    { resource: 'billing', action: 'read', scope: 'own' },
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
            limits: { maxStations: 25, maxChargers: 100, maxUsers: 10 },
            features: {
                create: [
                    { name: 'Up to 25 chargers', category: 'CAPACITY', order: 1 },
                    { name: 'Smart charging', category: 'FEATURES', order: 2 },
                    { name: 'Priority support', category: 'SUPPORT', order: 3 },
                    { name: 'Advanced analytics', category: 'ANALYTICS', order: 4 },
                ]
            },
            permissions: {
                create: [
                    { resource: 'stations', action: 'read', scope: 'own', limit: 25 },
                    { resource: 'stations', action: 'create', scope: 'own', limit: 25 },
                    { resource: 'stations', action: 'update', scope: 'own' },
                    { resource: 'analytics', action: 'read', scope: 'advanced' },
                    { resource: 'billing', action: 'read', scope: 'own' },
                    { resource: 'billing', action: 'update', scope: 'own' },
                    { resource: 'tou', action: 'manage', scope: 'own' },
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
            limits: { maxStations: -1, maxChargers: -1, maxUsers: -1 }, // -1 = unlimited
            features: {
                create: [
                    { name: 'Unlimited chargers', category: 'CAPACITY', order: 1 },
                    { name: 'SLA guarantees', category: 'SUPPORT', order: 2 },
                    { name: 'Dedicated account manager', category: 'SUPPORT', order: 3 },
                    { name: 'OCPI Roaming', category: 'FEATURES', order: 4 },
                    { name: 'Custom integrations', category: 'FEATURES', order: 5 },
                ]
            },
            permissions: {
                create: [
                    { resource: 'stations', action: 'read', scope: 'own' },
                    { resource: 'stations', action: 'create', scope: 'own' },
                    { resource: 'stations', action: 'update', scope: 'own' },
                    { resource: 'stations', action: 'delete', scope: 'own' },
                    { resource: 'analytics', action: 'read', scope: 'all' },
                    { resource: 'billing', action: 'manage', scope: 'own' },
                    { resource: 'roaming', action: 'manage', scope: 'own' },
                    { resource: 'settlement', action: 'manage', scope: 'own' },
                    { resource: 'api', action: 'access', scope: 'own' },
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
            limits: { maxStations: 3, maxUsers: 5 },
            features: {
                create: [
                    { name: 'Up to 3 stations', category: 'CAPACITY', order: 1 },
                    { name: 'Basic dashboard', category: 'FEATURES', order: 2 },
                    { name: 'Email support', category: 'SUPPORT', order: 3 },
                ]
            },
            permissions: {
                create: [
                    { resource: 'stations', action: 'read', scope: 'assigned', limit: 3 },
                    { resource: 'sessions', action: 'read', scope: 'assigned' },
                    { resource: 'incidents', action: 'create', scope: 'assigned' },
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
            limits: { maxStations: -1, maxUsers: 20 },
            features: {
                create: [
                    { name: 'Unlimited stations', category: 'CAPACITY', order: 1 },
                    { name: 'Team management', category: 'FEATURES', order: 2 },
                    { name: 'Advanced analytics', category: 'ANALYTICS', order: 3 },
                    { name: 'Priority support', category: 'SUPPORT', order: 4 },
                ]
            },
            permissions: {
                create: [
                    { resource: 'stations', action: 'read', scope: 'assigned' },
                    { resource: 'stations', action: 'update', scope: 'assigned' },
                    { resource: 'sessions', action: 'read', scope: 'assigned' },
                    { resource: 'incidents', action: 'manage', scope: 'assigned' },
                    { resource: 'analytics', action: 'read', scope: 'advanced' },
                    { resource: 'team', action: 'manage', scope: 'own' },
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
                    { name: 'Public marketplace', category: 'FEATURES', order: 1 },
                    { name: 'Job notifications', category: 'FEATURES', order: 2 },
                ]
            },
            permissions: {
                create: [
                    { resource: 'jobs', action: 'read', scope: 'public' },
                    { resource: 'jobs', action: 'apply', scope: 'public' },
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
                    { name: 'Priority job matching', category: 'FEATURES', order: 1 },
                    { name: 'Certification showcase', category: 'FEATURES', order: 2 },
                    { name: 'Analytics dashboard', category: 'ANALYTICS', order: 3 },
                ]
            },
            permissions: {
                create: [
                    { resource: 'jobs', action: 'read', scope: 'all' },
                    { resource: 'jobs', action: 'apply', scope: 'priority' },
                    { resource: 'certifications', action: 'manage', scope: 'own' },
                    { resource: 'analytics', action: 'read', scope: 'own' },
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
            limits: { maxSites: 3 },
            features: {
                create: [
                    { name: 'List up to 3 sites', category: 'CAPACITY', order: 1 },
                    { name: 'Standard listing', category: 'FEATURES', order: 2 },
                ]
            },
            permissions: {
                create: [
                    { resource: 'sites', action: 'read', scope: 'own', limit: 3 },
                    { resource: 'sites', action: 'create', scope: 'own', limit: 3 },
                    { resource: 'applications', action: 'read', scope: 'own' },
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
            limits: { maxSites: -1 },
            features: {
                create: [
                    { name: 'Unlimited sites', category: 'CAPACITY', order: 1 },
                    { name: 'Featured listings', category: 'FEATURES', order: 2 },
                    { name: 'Revenue analytics', category: 'ANALYTICS', order: 3 },
                    { name: 'Priority support', category: 'SUPPORT', order: 4 },
                ]
            },
            permissions: {
                create: [
                    { resource: 'sites', action: 'read', scope: 'own' },
                    { resource: 'sites', action: 'create', scope: 'own' },
                    { resource: 'sites', action: 'update', scope: 'own' },
                    { resource: 'applications', action: 'manage', scope: 'own' },
                    { resource: 'analytics', action: 'read', scope: 'own' },
                    { resource: 'featured', action: 'access', scope: 'own' },
                ]
            }
        }
    });

    console.log('Subscription plans seeded');

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
