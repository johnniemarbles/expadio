BEGIN;

ALTER TABLE platform.ai_jobs
  ADD COLUMN requested_at timestamptz;

ALTER TABLE platform.ai_jobs
  DISABLE TRIGGER ai_jobs_immutable;

UPDATE platform.ai_jobs
   SET requested_at = created_at
 WHERE requested_at IS NULL;

ALTER TABLE platform.ai_jobs
  ENABLE TRIGGER ai_jobs_immutable;

ALTER TABLE platform.ai_jobs
  ALTER COLUMN requested_at SET NOT NULL;

COMMIT;
