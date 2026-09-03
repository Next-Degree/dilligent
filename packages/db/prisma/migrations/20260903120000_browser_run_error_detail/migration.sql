-- Keep the raw underlying error on a browser automation run, alongside the
-- classified user-facing `error`. When classification finds no matching
-- pattern it writes "Browser automation failed for an unknown reason", which
-- discarded the only description of what actually went wrong — leaving the
-- Trigger.dev worker logs as the sole record.
--
-- Additive and nullable; existing rows and behavior are untouched.

-- AlterTable
ALTER TABLE "BrowserAutomationRun" ADD COLUMN "errorDetail" TEXT;
