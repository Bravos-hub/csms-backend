-- CreateTable
CREATE TABLE "tenant_applications" (
    "id" TEXT NOT NULL,
    "applicantId" TEXT NOT NULL,
    "organizationName" TEXT NOT NULL,
    "businessRegistrationNumber" TEXT NOT NULL,
    "taxComplianceNumber" TEXT,
    "contactPersonName" TEXT NOT NULL,
    "contactEmail" TEXT NOT NULL,
    "contactPhone" TEXT NOT NULL,
    "physicalAddress" TEXT NOT NULL,
    "companyWebsite" TEXT,
    "yearsInEVBusiness" TEXT NOT NULL,
    "existingStationsOperated" INTEGER,
    "siteId" TEXT NOT NULL,
    "preferredLeaseModel" TEXT NOT NULL,
    "businessPlanSummary" TEXT NOT NULL,
    "sustainabilityCommitments" TEXT,
    "additionalServices" TEXT NOT NULL DEFAULT '[]',
    "estimatedStartDate" TEXT,
    "proposedRent" DOUBLE PRECISION,
    "proposedTerm" INTEGER,
    "numberOfChargingPoints" INTEGER,
    "totalPowerRequirement" DOUBLE PRECISION,
    "chargingTechnology" TEXT NOT NULL DEFAULT '[]',
    "targetCustomerSegment" TEXT NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'Pending',
    "message" TEXT,
    "responseMessage" TEXT,
    "respondedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_applications_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "tenant_applications" ADD CONSTRAINT "tenant_applications_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;
