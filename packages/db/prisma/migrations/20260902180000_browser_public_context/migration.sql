-- The organization's single Browserbase context for public (no-login) evidence
-- runs. Sessions open on it only with persistence disabled, so it is never
-- written to and stays permanently signed-out.
--
-- It exists because the tenant guards prove a session belongs to an org by way
-- of its context: the per-run throwaway context public runs used before was
-- owned by nobody, so every guard rejected it as another org's. Kept separate
-- from BrowserbaseContext, which is a real shared browser holding vendor
-- cookies.
--
-- New table only — no existing row or behavior changes.

-- CreateTable
CREATE TABLE "public"."BrowserPublicContext" (
    "id" TEXT NOT NULL DEFAULT generate_prefixed_cuid('bpc'::text),
    "organizationId" TEXT NOT NULL,
    "contextId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BrowserPublicContext_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BrowserPublicContext_organizationId_key" ON "public"."BrowserPublicContext"("organizationId");

-- CreateIndex
CREATE INDEX "BrowserPublicContext_organizationId_idx" ON "public"."BrowserPublicContext"("organizationId");

-- AddForeignKey
ALTER TABLE "public"."BrowserPublicContext" ADD CONSTRAINT "BrowserPublicContext_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
