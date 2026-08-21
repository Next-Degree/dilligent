-- CreateEnum
CREATE TYPE "VendorContractTerm" AS ENUM ('monthly', 'yearly');

-- CreateEnum
CREATE TYPE "VendorCostModel" AS ENUM ('fixed', 'per_seat', 'usage_based', 'mixed');

-- AlterTable
ALTER TABLE "Vendor" ADD COLUMN     "contractTerm" "VendorContractTerm",
ADD COLUMN     "costCents" INTEGER,
ADD COLUMN     "costModel" "VendorCostModel",
ADD COLUMN     "noticePeriodDays" INTEGER,
ADD COLUMN     "ownerId" TEXT,
ADD COLUMN     "renewalDate" TIMESTAMP(3),
ADD COLUMN     "totalSeats" INTEGER,
ADD COLUMN     "usedSeats" INTEGER;

-- CreateIndex
CREATE INDEX "Vendor_ownerId_idx" ON "Vendor"("ownerId");

-- AddForeignKey
ALTER TABLE "Vendor" ADD CONSTRAINT "Vendor_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Member"("id") ON DELETE SET NULL ON UPDATE CASCADE;

