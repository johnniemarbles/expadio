BEGIN;

ALTER TABLE platform.capabilities
  ADD COLUMN IF NOT EXISTS department text NOT NULL DEFAULT 'General',
  ADD COLUMN IF NOT EXISTS description text NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS capabilities_department_idx
  ON platform.capabilities (department);

COMMIT;
