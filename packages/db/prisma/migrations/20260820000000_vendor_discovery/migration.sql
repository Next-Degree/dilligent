-- CreateEnum
CREATE TYPE "DiscoveredVendorStatus" AS ENUM ('pending', 'approved', 'ignored');

-- CreateEnum
CREATE TYPE "DiscoveredVendorSource" AS ENUM ('google_workspace');

-- CreateEnum
CREATE TYPE "VendorResolutionMethod" AS ENUM ('existing_vendor', 'global_catalogue', 'integration_definition', 'inferred', 'unresolved');

-- CreateEnum
CREATE TYPE "VendorAccessGrantSource" AS ENUM ('google_workspace', 'manual');

-- CreateEnum
CREATE TYPE "VendorAccessGrantRevokedReason" AS ENUM ('not_observed', 'offboarding', 'manual');

-- CreateEnum
CREATE TYPE "VendorSource" AS ENUM ('manual', 'discovered');

-- AlterTable
ALTER TABLE "Vendor" ADD COLUMN     "discoveredAt" TIMESTAMP(3),
ADD COLUMN     "source" "VendorSource" NOT NULL DEFAULT 'manual';

-- CreateTable
CREATE TABLE "DiscoveredVendorCandidate" (
    "id" TEXT NOT NULL DEFAULT generate_prefixed_cuid('dvc'::text),
    "organizationId" TEXT NOT NULL,
    "source" "DiscoveredVendorSource" NOT NULL,
    "externalAppId" TEXT NOT NULL,
    "displayName" TEXT,
    "status" "DiscoveredVendorStatus" NOT NULL DEFAULT 'pending',
    "ignoredReason" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "disappearedAt" TIMESTAMP(3),
    "granteeCount" INTEGER NOT NULL DEFAULT 0,
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "resolutionMethod" "VendorResolutionMethod" NOT NULL DEFAULT 'unresolved',
    "resolvedName" TEXT,
    "resolvedWebsite" TEXT,
    "resolvedDescription" TEXT,
    "resolvedCategory" "VendorCategory",
    "confidence" DOUBLE PRECISION,
    "inferenceAttemptedAt" TIMESTAMP(3),
    "inferenceDisplayName" TEXT,
    "inferenceRawOutput" JSONB,
    "vendorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DiscoveredVendorCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VendorAccessGrant" (
    "id" TEXT NOT NULL DEFAULT generate_prefixed_cuid('vag'::text),
    "organizationId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "source" "VendorAccessGrantSource" NOT NULL,
    "externalAppId" TEXT NOT NULL,
    "candidateId" TEXT,
    "vendorId" TEXT,
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "revokedReason" "VendorAccessGrantRevokedReason",
    "reappearedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VendorAccessGrant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DiscoveredVendorCandidate_organizationId_status_idx" ON "DiscoveredVendorCandidate"("organizationId", "status");

-- CreateIndex
CREATE INDEX "DiscoveredVendorCandidate_vendorId_idx" ON "DiscoveredVendorCandidate"("vendorId");

-- CreateIndex
CREATE INDEX "DiscoveredVendorCandidate_decidedById_idx" ON "DiscoveredVendorCandidate"("decidedById");

-- CreateIndex
CREATE UNIQUE INDEX "DiscoveredVendorCandidate_organizationId_source_externalApp_key" ON "DiscoveredVendorCandidate"("organizationId", "source", "externalAppId");

-- CreateIndex
CREATE INDEX "VendorAccessGrant_organizationId_vendorId_idx" ON "VendorAccessGrant"("organizationId", "vendorId");

-- CreateIndex
CREATE INDEX "VendorAccessGrant_organizationId_memberId_idx" ON "VendorAccessGrant"("organizationId", "memberId");

-- CreateIndex
CREATE INDEX "VendorAccessGrant_candidateId_idx" ON "VendorAccessGrant"("candidateId");

-- CreateIndex
CREATE INDEX "VendorAccessGrant_vendorId_idx" ON "VendorAccessGrant"("vendorId");

-- CreateIndex
CREATE UNIQUE INDEX "VendorAccessGrant_organizationId_memberId_source_externalAp_key" ON "VendorAccessGrant"("organizationId", "memberId", "source", "externalAppId");

-- AddForeignKey
ALTER TABLE "DiscoveredVendorCandidate" ADD CONSTRAINT "DiscoveredVendorCandidate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscoveredVendorCandidate" ADD CONSTRAINT "DiscoveredVendorCandidate_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscoveredVendorCandidate" ADD CONSTRAINT "DiscoveredVendorCandidate_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorAccessGrant" ADD CONSTRAINT "VendorAccessGrant_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorAccessGrant" ADD CONSTRAINT "VendorAccessGrant_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorAccessGrant" ADD CONSTRAINT "VendorAccessGrant_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "DiscoveredVendorCandidate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorAccessGrant" ADD CONSTRAINT "VendorAccessGrant_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

