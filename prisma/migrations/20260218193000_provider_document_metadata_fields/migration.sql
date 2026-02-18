ALTER TABLE "provider_documents"
  ADD COLUMN "requirementCode" TEXT,
  ADD COLUMN "category" TEXT,
  ADD COLUMN "issuer" TEXT,
  ADD COLUMN "documentNumber" TEXT,
  ADD COLUMN "issueDate" TIMESTAMP(3),
  ADD COLUMN "expiryDate" TIMESTAMP(3),
  ADD COLUMN "coveredModels" TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "coveredSites" TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "version" TEXT,
  ADD COLUMN "metadata" JSONB,
  ADD COLUMN "reviewedBy" TEXT,
  ADD COLUMN "reviewedAt" TIMESTAMP(3),
  ADD COLUMN "reviewNotes" TEXT;

CREATE INDEX "provider_documents_requirementCode_idx" ON "provider_documents"("requirementCode");
CREATE INDEX "provider_documents_expiryDate_idx" ON "provider_documents"("expiryDate");

