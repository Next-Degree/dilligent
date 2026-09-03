-- Keep the raw underlying error on a browser automation run, alongside the
-- classified user-facing `error`.
--
-- Additive and nullable; existing rows and behavior are untouched.

-- AlterTable
ALTER TABLE "BrowserAutomationRun" ADD COLUMN "errorDetail" TEXT;
