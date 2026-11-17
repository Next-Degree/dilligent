-- Contract phase of the training renewal change: drop the original unique
-- index on ("memberId", "videoId").
--
-- 20261110000000_training_completion_cycles added "cycle" and a unique index
-- on ("memberId", "videoId", "cycle") but kept this one, because the code then
-- running upserted on it. Every writer now upserts on the cycle aware key, and
-- while this index exists a module can only ever have one row, so a member's
-- yearly renewal (a second cycle row) cannot be saved.
--
-- Rollout: this ships in the same release as the code that writes renewal
-- rows. Migrations run on merge independently of the app deploys, so an
-- instance still running the previous code can fail a training completion for
-- the few minutes of the rollout. That window was accepted over the
-- alternative of renewals failing until a separate later release.

-- DropIndex
DROP INDEX "EmployeeTrainingVideoCompletion_memberId_videoId_key";
