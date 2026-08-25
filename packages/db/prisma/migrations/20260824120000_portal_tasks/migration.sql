-- CreateEnum
CREATE TYPE "PortalTaskKind" AS ENUM ('acknowledgement', 'link');

-- CreateTable
CREATE TABLE "PortalTask" (
    "id" TEXT NOT NULL DEFAULT generate_prefixed_cuid('ptsk'::text),
    "organizationId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "kind" "PortalTaskKind" NOT NULL DEFAULT 'acknowledgement',
    "externalUrl" TEXT,
    "acknowledgementText" TEXT,
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "isRequired" BOOLEAN NOT NULL DEFAULT true,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdByMemberId" TEXT,

    CONSTRAINT "PortalTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PortalTaskCompletion" (
    "id" TEXT NOT NULL DEFAULT generate_prefixed_cuid('ptc'::text),
    "portalTaskId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledgedText" TEXT,

    CONSTRAINT "PortalTaskCompletion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PortalTask_organizationId_isArchived_idx" ON "PortalTask"("organizationId", "isArchived");

-- CreateIndex
CREATE INDEX "PortalTask_createdByMemberId_idx" ON "PortalTask"("createdByMemberId");

-- CreateIndex
CREATE INDEX "PortalTaskCompletion_memberId_idx" ON "PortalTaskCompletion"("memberId");

-- CreateIndex
CREATE UNIQUE INDEX "PortalTaskCompletion_portalTaskId_memberId_key" ON "PortalTaskCompletion"("portalTaskId", "memberId");

-- AddForeignKey
ALTER TABLE "PortalTask" ADD CONSTRAINT "PortalTask_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortalTask" ADD CONSTRAINT "PortalTask_createdByMemberId_fkey" FOREIGN KEY ("createdByMemberId") REFERENCES "Member"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortalTaskCompletion" ADD CONSTRAINT "PortalTaskCompletion_portalTaskId_fkey" FOREIGN KEY ("portalTaskId") REFERENCES "PortalTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortalTaskCompletion" ADD CONSTRAINT "PortalTaskCompletion_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A `link` task is unusable without a destination; Prisma cannot express this.
-- Keep in sync with portal-task.prisma.
ALTER TABLE "PortalTask" ADD CONSTRAINT "portal_task_link_requires_url" CHECK ("kind" <> 'link' OR "externalUrl" IS NOT NULL);
