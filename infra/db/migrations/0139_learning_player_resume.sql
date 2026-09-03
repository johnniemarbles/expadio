BEGIN;

ALTER TABLE platform.learning_lesson_progress
  ADD COLUMN IF NOT EXISTS resume_block_id text,
  ADD COLUMN IF NOT EXISTS resume_position integer,
  ADD COLUMN IF NOT EXISTS last_viewed_at timestamptz;

ALTER TABLE platform.learning_lesson_progress
  DROP CONSTRAINT IF EXISTS learning_lesson_progress_resume_position_check;
ALTER TABLE platform.learning_lesson_progress
  ADD CONSTRAINT learning_lesson_progress_resume_position_check
  CHECK (resume_position IS NULL OR resume_position >= 1);

ALTER TABLE platform.learning_lesson_progress
  DROP CONSTRAINT IF EXISTS learning_lesson_progress_resume_consistency;
ALTER TABLE platform.learning_lesson_progress
  ADD CONSTRAINT learning_lesson_progress_resume_consistency
  CHECK (
    (resume_block_id IS NULL AND resume_position IS NULL)
    OR (resume_block_id IS NOT NULL AND resume_position IS NOT NULL)
  );

COMMENT ON COLUMN platform.learning_lesson_progress.resume_block_id IS
  'Stable schema-v1 lesson block identifier last opened by the authenticated learner.';
COMMENT ON COLUMN platform.learning_lesson_progress.resume_position IS
  'One-based block position corresponding to resume_block_id.';
COMMENT ON COLUMN platform.learning_lesson_progress.last_viewed_at IS
  'Server-recorded learner view time; never inferred from client timers.';

COMMIT;
