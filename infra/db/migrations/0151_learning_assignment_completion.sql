BEGIN;

-- LMS-18 — make published assignments an explicit course-completion requirement.
ALTER TABLE platform.learning_assignment_versions
  ADD COLUMN completion_requirement text NOT NULL DEFAULT 'REQUIRED'
  CHECK (completion_requirement IN ('OPTIONAL','REQUIRED'));

COMMENT ON COLUMN platform.learning_assignment_versions.completion_requirement IS
  'Authoritative completion policy. REQUIRED assignments must have a final GRADED submission for the pinned enrollment.';

COMMIT;
