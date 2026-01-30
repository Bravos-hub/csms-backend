import { PrismaClient, SitePurpose, LeaseType, Footfall } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    console.log('Seeding database...');

    // 1. Create Mock User
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
            status: 'Pending',
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
            status: 'Approved',
            responseMessage: 'We are pleased to approve your application. Please review the proposed terms.',
            respondedAt: new Date('2026-01-15')
        }
    });

    console.log('Sample tenant applications seeded');

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
