-- Per-step auth mode for browser evidence. `saved_session` is today's behavior
-- (reuse the bound connection's logged-in context); `public` runs the step in a
-- throwaway, non-persistent session for a page that needs no login.
-- Additive with a default, so existing rows keep behaving exactly as before.

-- CreateEnum
CREATE TYPE "BrowserStepAuthMode" AS ENUM ('saved_session', 'public');

-- AlterTable
ALTER TABLE "BrowserAutomationStep" ADD COLUMN "authMode" "BrowserStepAuthMode" NOT NULL DEFAULT 'saved_session';
