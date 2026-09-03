-- Splits vendor classification into independent dimensions. `VendorCategory` used
-- to mix what a vendor DOES with how it is DELIVERED — `software_as_a_service`
-- occupied the functional slot while answering a different question — which made
-- the category unusable for risk analysis and ISMS scoping.
--
-- Expand phase only. The retired values (cloud, infrastructure,
-- software_as_a_service, hr) stay in the enum type: Postgres cannot drop an enum
-- value, and dropping the column type while old instances are still writing those
-- values would fail mid rolling-deploy. Data is moved off them by the backfill in
-- 20260901000100_vendor_classification_backfill, which must be a separate
-- migration because a value added by ALTER TYPE cannot be used in the same
-- transaction that adds it. A later contract migration drops them once every
-- instance runs the new code.

-- CreateEnum
CREATE TYPE "VendorDeliveryModel" AS ENUM ('saas', 'cloud_service', 'api_service', 'managed_service', 'desktop_application', 'mobile_application', 'browser_extension', 'open_source', 'internal_application', 'other');

-- CreateEnum
CREATE TYPE "DataServiceType" AS ENUM ('people_data', 'company_data', 'contact_data', 'web_data', 'financial_data', 'intent_data', 'search', 'scraping', 'enrichment', 'verification', 'matching', 'other');

-- CreateEnum
CREATE TYPE "DataFlowRole" AS ENUM ('source', 'processor', 'destination');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "VendorCategory" ADD VALUE 'cloud_infrastructure';
ALTER TYPE "VendorCategory" ADD VALUE 'engineering_developer_tools';
ALTER TYPE "VendorCategory" ADD VALUE 'security_compliance';
ALTER TYPE "VendorCategory" ADD VALUE 'identity_access_management';
ALTER TYPE "VendorCategory" ADD VALUE 'artificial_intelligence';
ALTER TYPE "VendorCategory" ADD VALUE 'data_provider';
ALTER TYPE "VendorCategory" ADD VALUE 'data_enrichment';
ALTER TYPE "VendorCategory" ADD VALUE 'data_collection';
ALTER TYPE "VendorCategory" ADD VALUE 'automation_integration';
ALTER TYPE "VendorCategory" ADD VALUE 'analytics_observability';
ALTER TYPE "VendorCategory" ADD VALUE 'collaboration_productivity';
ALTER TYPE "VendorCategory" ADD VALUE 'design_creative';
ALTER TYPE "VendorCategory" ADD VALUE 'hr_recruiting';
ALTER TYPE "VendorCategory" ADD VALUE 'legal';
ALTER TYPE "VendorCategory" ADD VALUE 'customer_support';

-- AlterTable
ALTER TABLE "Vendor" ADD COLUMN     "dataFlowRoles" "DataFlowRole"[] DEFAULT ARRAY[]::"DataFlowRole"[],
ADD COLUMN     "dataServiceTypes" "DataServiceType"[] DEFAULT ARRAY[]::"DataServiceType"[],
ADD COLUMN     "deliveryModels" "VendorDeliveryModel"[] DEFAULT ARRAY[]::"VendorDeliveryModel"[];

-- CreateTable
CREATE TABLE "VendorClassificationReview" (
    "id" TEXT NOT NULL DEFAULT generate_prefixed_cuid('vcr'::text),
    "organizationId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "previousCategory" TEXT NOT NULL,
    "assignedCategory" "VendorCategory" NOT NULL,
    "reason" TEXT NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VendorClassificationReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VendorClassificationReview_organizationId_resolvedAt_idx" ON "VendorClassificationReview"("organizationId", "resolvedAt");

-- CreateIndex
CREATE INDEX "VendorClassificationReview_vendorId_idx" ON "VendorClassificationReview"("vendorId");

-- AddForeignKey
ALTER TABLE "VendorClassificationReview" ADD CONSTRAINT "VendorClassificationReview_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
