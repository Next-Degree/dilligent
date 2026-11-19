-- Adds annual renewal cycles to training completions.
--
-- Each module can now have one row per cycle: cycle 1 is the original
-- completion, cycle 2 the first yearly renewal, and so on. `dueAt` records when
-- a pending renewal row must be finished by.
--
-- Expand phase only. The original unique index on ("memberId", "videoId") is
-- deliberately kept: the running code upserts on that key, and dropping it
-- mid rolling-deploy would make those upserts fail. While it exists a module
-- can only have one row, which is fine because nothing creates a second-cycle
-- row yet. A later contract migration drops it, shipped together with the code
-- that upserts on ("memberId", "videoId", "cycle").
--
-- Existing rows take the column default, so they all become cycle 1.

-- AlterTable
ALTER TABLE "EmployeeTrainingVideoCompletion" ADD COLUMN     "cycle" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "dueAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "EmployeeTrainingVideoCompletion_memberId_videoId_cycle_key" ON "EmployeeTrainingVideoCompletion"("memberId", "videoId", "cycle");
