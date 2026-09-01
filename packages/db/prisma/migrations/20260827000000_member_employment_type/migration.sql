-- CreateEnum
CREATE TYPE "EmploymentType" AS ENUM ('permanent', 'contract');

-- AlterTable
ALTER TABLE "Member" ADD COLUMN     "employmentType" "EmploymentType" NOT NULL DEFAULT 'permanent',
ADD COLUMN     "contractExpiryDate" TIMESTAMP(3);
