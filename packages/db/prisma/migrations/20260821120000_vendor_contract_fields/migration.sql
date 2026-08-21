-- Commercial contract details on Vendor: seat counts, renewal date, annual
-- spend (USD cents), contract term, notice period and the business owner.
-- All additive and nullable — existing vendors keep working untouched.

-- CreateEnum
CREATE TYPE "VendorContractTerm" AS ENUM ('monthly', 'yearly');

-- AlterTable
ALTER TABLE "Vendor" ADD COLUMN     "annualCostCents" INTEGER,
ADD COLUMN     "contractTerm" "VendorContractTerm",
ADD COLUMN     "noticePeriodDays" INTEGER,
ADD COLUMN     "ownerId" TEXT,
ADD COLUMN     "renewalDate" TIMESTAMP(3),
ADD COLUMN     "totalSeats" INTEGER,
ADD COLUMN     "usedSeats" INTEGER;

-- CreateIndex
CREATE INDEX "Vendor_ownerId_idx" ON "Vendor"("ownerId");

-- AddForeignKey
ALTER TABLE "Vendor" ADD CONSTRAINT "Vendor_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Member"("id") ON DELETE SET NULL ON UPDATE CASCADE;

