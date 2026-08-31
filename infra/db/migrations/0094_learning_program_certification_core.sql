BEGIN;

-- LMS-04 — versioned programs, learner program assignments, certifications,
-- governed credential issuance, and renewal/expiry lifecycle.

CREATE TABLE platform.learning_programs (
  program_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
  academy_id uuid NOT NULL,
  program_key text NOT NULL CHECK (program_key ~ '^[a-z0-9]+([._-][a-z0-9]+)*$'),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','ARCHIVED')),
  current_published_version integer CHECK (current_published_version IS NULL OR current_published_version > 0),
  created_by_subject_id text NOT NULL CHECK (btrim(created_by_subject_id) <> ''),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (program_id, tenant_id),
  UNIQUE (tenant_id, program_key),
  FOREIGN KEY (academy_id, tenant_id)
    REFERENCES platform.learning_academies(academy_id, tenant_id)
    ON DELETE RESTRICT
);

CREATE TABLE platform.learning_program_versions (
  program_version_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
  program_id uuid NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  state text NOT NULL DEFAULT 'DRAFT'
    CHECK (state IN ('DRAFT','PUBLISHED','SUPERSEDED','ARCHIVED')),
  title text NOT NULL CHECK (btrim(title) <> ''),
  description text NOT NULL DEFAULT '',
  created_by_subject_id text NOT NULL CHECK (btrim(created_by_subject_id) <> ''),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by_subject_id text NOT NULL CHECK (btrim(updated_by_subject_id) <> ''),
  updated_at timestamptz NOT NULL DEFAULT now(),
  published_by_subject_id text,
  published_at timestamptz,
  UNIQUE (program_version_id, tenant_id),
  UNIQUE (program_version_id, tenant_id, program_id),
  UNIQUE (program_id, version),
  FOREIGN KEY (program_id, tenant_id)
    REFERENCES platform.learning_programs(program_id, tenant_id)
    ON DELETE CASCADE,
  CONSTRAINT learning_program_publish_metadata CHECK (
    (published_by_subject_id IS NULL AND published_at IS NULL)
    OR (published_by_subject_id IS NOT NULL AND published_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX learning_program_one_published_uq
  ON platform.learning_program_versions(program_id)
  WHERE state = 'PUBLISHED';

CREATE TABLE platform.learning_program_items (
  program_item_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
  program_version_id uuid NOT NULL,
  item_type text NOT NULL CHECK (item_type IN ('COURSE','ASSESSMENT')),
  course_version_id uuid,
  assessment_version_id uuid,
  position integer NOT NULL CHECK (position > 0),
  required boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (program_item_id, tenant_id),
  UNIQUE (program_version_id, position),
  FOREIGN KEY (program_version_id, tenant_id)
    REFERENCES platform.learning_program_versions(program_version_id, tenant_id)
    ON DELETE CASCADE,
  FOREIGN KEY (course_version_id, tenant_id)
    REFERENCES platform.learning_course_versions(course_version_id, tenant_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (assessment_version_id, tenant_id)
    REFERENCES platform.learning_assessment_versions(assessment_version_id, tenant_id)
    ON DELETE RESTRICT,
  CONSTRAINT learning_program_item_target CHECK (
    (item_type = 'COURSE' AND course_version_id IS NOT NULL AND assessment_version_id IS NULL)
    OR
    (item_type = 'ASSESSMENT' AND assessment_version_id IS NOT NULL AND course_version_id IS NULL)
  )
);

CREATE UNIQUE INDEX learning_program_course_item_uq
  ON platform.learning_program_items(program_version_id, course_version_id)
  WHERE course_version_id IS NOT NULL;

CREATE UNIQUE INDEX learning_program_assessment_item_uq
  ON platform.learning_program_items(program_version_id, assessment_version_id)
  WHERE assessment_version_id IS NOT NULL;

CREATE TABLE platform.learning_program_enrollments (
  program_enrollment_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
  learner_id uuid NOT NULL,
  program_id uuid NOT NULL,
  program_version_id uuid NOT NULL,
  assignment_key text NOT NULL CHECK (
    assignment_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$'
  ),
  source_type text NOT NULL DEFAULT 'MANUAL'
    CHECK (source_type IN ('MANUAL','RULE','IMPORT','SELF')),
  status text NOT NULL DEFAULT 'ASSIGNED'
    CHECK (status IN ('ASSIGNED','IN_PROGRESS','COMPLETED','CANCELLED')),
  assigned_by_subject_id text NOT NULL CHECK (btrim(assigned_by_subject_id) <> ''),
  assigned_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  completion_percent numeric(5,2) NOT NULL DEFAULT 0
    CHECK (completion_percent >= 0 AND completion_percent <= 100),
  last_reconciled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (program_enrollment_id, tenant_id),
  UNIQUE (program_enrollment_id, tenant_id, learner_id, program_version_id),
  UNIQUE (tenant_id, assignment_key),
  FOREIGN KEY (learner_id, tenant_id)
    REFERENCES platform.learning_learners(learner_id, tenant_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (program_id, tenant_id)
    REFERENCES platform.learning_programs(program_id, tenant_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (program_version_id, tenant_id, program_id)
    REFERENCES platform.learning_program_versions(program_version_id, tenant_id, program_id)
    ON DELETE RESTRICT,
  CONSTRAINT learning_program_enrollment_completion CHECK (
    (status = 'COMPLETED' AND completed_at IS NOT NULL AND completion_percent = 100)
    OR status <> 'COMPLETED'
  )
);

CREATE INDEX learning_program_enrollments_learner_idx
  ON platform.learning_program_enrollments
  (tenant_id, learner_id, status, assigned_at DESC);

CREATE TABLE platform.learning_certifications (
  certification_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
  academy_id uuid NOT NULL,
  certification_key text NOT NULL CHECK (
    certification_key ~ '^[a-z0-9]+([._-][a-z0-9]+)*$'
  ),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','ARCHIVED')),
  current_published_version integer CHECK (
    current_published_version IS NULL OR current_published_version > 0
  ),
  created_by_subject_id text NOT NULL CHECK (btrim(created_by_subject_id) <> ''),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (certification_id, tenant_id),
  UNIQUE (tenant_id, certification_key),
  FOREIGN KEY (academy_id, tenant_id)
    REFERENCES platform.learning_academies(academy_id, tenant_id)
    ON DELETE RESTRICT
);

CREATE TABLE platform.learning_certification_versions (
  certification_version_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
  certification_id uuid NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  state text NOT NULL DEFAULT 'DRAFT'
    CHECK (state IN ('DRAFT','PUBLISHED','SUPERSEDED','ARCHIVED')),
  title text NOT NULL CHECK (btrim(title) <> ''),
  description text NOT NULL DEFAULT '',
  program_version_id uuid NOT NULL,
  validity_days integer CHECK (validity_days IS NULL OR validity_days > 0),
  renewal_window_days integer CHECK (
    renewal_window_days IS NULL OR renewal_window_days > 0
  ),
  created_by_subject_id text NOT NULL CHECK (btrim(created_by_subject_id) <> ''),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by_subject_id text NOT NULL CHECK (btrim(updated_by_subject_id) <> ''),
  updated_at timestamptz NOT NULL DEFAULT now(),
  published_by_subject_id text,
  published_at timestamptz,
  UNIQUE (certification_version_id, tenant_id),
  UNIQUE (certification_version_id, tenant_id, certification_id),
  UNIQUE (certification_id, version),
  FOREIGN KEY (certification_id, tenant_id)
    REFERENCES platform.learning_certifications(certification_id, tenant_id)
    ON DELETE CASCADE,
  FOREIGN KEY (program_version_id, tenant_id)
    REFERENCES platform.learning_program_versions(program_version_id, tenant_id)
    ON DELETE RESTRICT,
  CONSTRAINT learning_certification_publish_metadata CHECK (
    (published_by_subject_id IS NULL AND published_at IS NULL)
    OR (published_by_subject_id IS NOT NULL AND published_at IS NOT NULL)
  ),
  CONSTRAINT learning_certification_renewal_window CHECK (
    (validity_days IS NULL AND renewal_window_days IS NULL)
    OR
    (validity_days IS NOT NULL
      AND (renewal_window_days IS NULL OR renewal_window_days < validity_days))
  )
);

CREATE UNIQUE INDEX learning_certification_one_published_uq
  ON platform.learning_certification_versions(certification_id)
  WHERE state = 'PUBLISHED';

CREATE INDEX learning_certification_program_version_idx
  ON platform.learning_certification_versions
  (tenant_id, program_version_id, state);

CREATE TABLE platform.learning_credentials (
  credential_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
  credential_key text NOT NULL CHECK (btrim(credential_key) <> ''),
  certification_id uuid NOT NULL,
  certification_version_id uuid NOT NULL,
  program_enrollment_id uuid NOT NULL,
  learner_id uuid NOT NULL,
  program_version_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE','EXPIRING','EXPIRED','REVOKED')),
  issued_by_subject_id text NOT NULL CHECK (btrim(issued_by_subject_id) <> ''),
  issued_at timestamptz NOT NULL DEFAULT now(),
  renewal_due_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz,
  revoked_by_subject_id text,
  revocation_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (credential_id, tenant_id),
  UNIQUE (tenant_id, credential_key),
  UNIQUE (tenant_id, learner_id, certification_version_id),
  FOREIGN KEY (certification_id, tenant_id)
    REFERENCES platform.learning_certifications(certification_id, tenant_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (certification_version_id, tenant_id, certification_id)
    REFERENCES platform.learning_certification_versions(
      certification_version_id, tenant_id, certification_id
    )
    ON DELETE RESTRICT,
  FOREIGN KEY (
    program_enrollment_id, tenant_id, learner_id, program_version_id
  )
    REFERENCES platform.learning_program_enrollments(
      program_enrollment_id, tenant_id, learner_id, program_version_id
    )
    ON DELETE RESTRICT,
  CONSTRAINT learning_credential_dates CHECK (
    (expires_at IS NULL AND renewal_due_at IS NULL)
    OR
    (expires_at IS NOT NULL
      AND (renewal_due_at IS NULL OR renewal_due_at < expires_at))
  ),
  CONSTRAINT learning_credential_revocation_shape CHECK (
    (status = 'REVOKED'
      AND revoked_at IS NOT NULL
      AND revoked_by_subject_id IS NOT NULL
      AND btrim(revoked_by_subject_id) <> ''
      AND revocation_reason IS NOT NULL
      AND btrim(revocation_reason) <> '')
    OR
    (status <> 'REVOKED'
      AND revoked_at IS NULL
      AND revoked_by_subject_id IS NULL
      AND revocation_reason IS NULL)
  )
);

CREATE INDEX learning_credentials_learner_idx
  ON platform.learning_credentials
  (tenant_id, learner_id, status, issued_at DESC);

CREATE INDEX learning_credentials_expiry_idx
  ON platform.learning_credentials
  (tenant_id, expires_at)
  WHERE status IN ('ACTIVE','EXPIRING') AND expires_at IS NOT NULL;

CREATE OR REPLACE FUNCTION platform.enforce_learning_program_version_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.state <> 'DRAFT' THEN
      RAISE EXCEPTION 'non-draft learning program versions are immutable'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.tenant_id IS DISTINCT FROM NEW.tenant_id
     OR OLD.program_id IS DISTINCT FROM NEW.program_id
     OR OLD.version IS DISTINCT FROM NEW.version THEN
    RAISE EXCEPTION 'learning program version identity is immutable'
      USING ERRCODE = 'check_violation';
  END IF;

  IF OLD.state <> 'DRAFT' AND (
       OLD.title IS DISTINCT FROM NEW.title
       OR OLD.description IS DISTINCT FROM NEW.description
     ) THEN
    RAISE EXCEPTION 'only draft learning program versions may edit content'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.state = 'PUBLISHED'
     AND (NEW.published_by_subject_id IS NULL OR NEW.published_at IS NULL) THEN
    RAISE EXCEPTION 'published learning program versions require publication provenance'
      USING ERRCODE = 'check_violation';
  END IF;

  IF OLD.state = 'DRAFT' AND NEW.state NOT IN ('DRAFT','PUBLISHED','ARCHIVED') THEN
    RAISE EXCEPTION 'invalid learning program version transition'
      USING ERRCODE = 'check_violation';
  ELSIF OLD.state = 'PUBLISHED' AND NEW.state NOT IN ('PUBLISHED','SUPERSEDED','ARCHIVED') THEN
    RAISE EXCEPTION 'invalid learning program version transition'
      USING ERRCODE = 'check_violation';
  ELSIF OLD.state = 'SUPERSEDED' AND NEW.state NOT IN ('SUPERSEDED','ARCHIVED') THEN
    RAISE EXCEPTION 'invalid learning program version transition'
      USING ERRCODE = 'check_violation';
  ELSIF OLD.state = 'ARCHIVED' AND NEW.state <> 'ARCHIVED' THEN
    RAISE EXCEPTION 'archived learning program versions are terminal'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.state = 'PUBLISHED' AND OLD.state <> 'PUBLISHED' THEN
    IF NOT EXISTS (
      SELECT 1
        FROM platform.learning_program_items item
       WHERE item.tenant_id = NEW.tenant_id
         AND item.program_version_id = NEW.program_version_id
         AND item.required = true
    ) THEN
      RAISE EXCEPTION 'published learning programs require at least one required item'
        USING ERRCODE = 'check_violation';
    END IF;

    IF EXISTS (
      SELECT 1
        FROM platform.learning_program_items item
        LEFT JOIN platform.learning_course_versions course_version
          ON course_version.course_version_id = item.course_version_id
         AND course_version.tenant_id = item.tenant_id
        LEFT JOIN platform.learning_assessment_versions assessment_version
          ON assessment_version.assessment_version_id = item.assessment_version_id
         AND assessment_version.tenant_id = item.tenant_id
       WHERE item.tenant_id = NEW.tenant_id
         AND item.program_version_id = NEW.program_version_id
         AND (
           (item.item_type = 'COURSE'
             AND course_version.state NOT IN ('PUBLISHED','SUPERSEDED'))
           OR
           (item.item_type = 'ASSESSMENT'
             AND assessment_version.state NOT IN ('PUBLISHED','SUPERSEDED'))
         )
    ) THEN
      RAISE EXCEPTION 'published learning programs require published requirement versions'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER learning_program_versions_lifecycle
BEFORE UPDATE OR DELETE ON platform.learning_program_versions
FOR EACH ROW EXECUTE FUNCTION platform.enforce_learning_program_version_lifecycle();

CREATE OR REPLACE FUNCTION platform.enforce_learning_program_item_draft()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  version_id uuid;
  target_tenant uuid;
  parent_state text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    version_id := OLD.program_version_id;
    target_tenant := OLD.tenant_id;
  ELSE
    version_id := NEW.program_version_id;
    target_tenant := NEW.tenant_id;
  END IF;

  SELECT state INTO parent_state
    FROM platform.learning_program_versions
   WHERE program_version_id = version_id
     AND tenant_id = target_tenant;

  IF parent_state IS NULL AND TG_OP = 'DELETE' THEN RETURN OLD; END IF;

  IF parent_state IS DISTINCT FROM 'DRAFT' THEN
    RAISE EXCEPTION 'learning program items may mutate only while version is DRAFT'
      USING ERRCODE = 'check_violation';
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER learning_program_items_draft_only
BEFORE INSERT OR UPDATE OR DELETE ON platform.learning_program_items
FOR EACH ROW EXECUTE FUNCTION platform.enforce_learning_program_item_draft();

CREATE OR REPLACE FUNCTION platform.enforce_learning_program_enrollment_binding()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  version_state text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.tenant_id IS DISTINCT FROM NEW.tenant_id
       OR OLD.learner_id IS DISTINCT FROM NEW.learner_id
       OR OLD.program_id IS DISTINCT FROM NEW.program_id
       OR OLD.program_version_id IS DISTINCT FROM NEW.program_version_id
       OR OLD.assignment_key IS DISTINCT FROM NEW.assignment_key THEN
      RAISE EXCEPTION 'learning program enrollment identity is immutable'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  SELECT state INTO version_state
    FROM platform.learning_program_versions
   WHERE tenant_id = NEW.tenant_id
     AND program_version_id = NEW.program_version_id
     AND program_id = NEW.program_id;

  IF version_state IS DISTINCT FROM 'PUBLISHED' THEN
    RAISE EXCEPTION 'new learning program enrollments require a published program version'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER learning_program_enrollment_binding
BEFORE INSERT OR UPDATE ON platform.learning_program_enrollments
FOR EACH ROW EXECUTE FUNCTION platform.enforce_learning_program_enrollment_binding();

CREATE OR REPLACE FUNCTION platform.enforce_learning_certification_version_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  program_state text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.state <> 'DRAFT' THEN
      RAISE EXCEPTION 'non-draft learning certification versions are immutable'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.tenant_id IS DISTINCT FROM NEW.tenant_id
     OR OLD.certification_id IS DISTINCT FROM NEW.certification_id
     OR OLD.version IS DISTINCT FROM NEW.version THEN
    RAISE EXCEPTION 'learning certification version identity is immutable'
      USING ERRCODE = 'check_violation';
  END IF;

  IF OLD.state <> 'DRAFT' AND (
       OLD.title IS DISTINCT FROM NEW.title
       OR OLD.description IS DISTINCT FROM NEW.description
       OR OLD.program_version_id IS DISTINCT FROM NEW.program_version_id
       OR OLD.validity_days IS DISTINCT FROM NEW.validity_days
       OR OLD.renewal_window_days IS DISTINCT FROM NEW.renewal_window_days
     ) THEN
    RAISE EXCEPTION 'only draft learning certification versions may edit content'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.state = 'PUBLISHED'
     AND (NEW.published_by_subject_id IS NULL OR NEW.published_at IS NULL) THEN
    RAISE EXCEPTION 'published learning certification versions require publication provenance'
      USING ERRCODE = 'check_violation';
  END IF;

  IF OLD.state = 'DRAFT' AND NEW.state NOT IN ('DRAFT','PUBLISHED','ARCHIVED') THEN
    RAISE EXCEPTION 'invalid learning certification version transition'
      USING ERRCODE = 'check_violation';
  ELSIF OLD.state = 'PUBLISHED' AND NEW.state NOT IN ('PUBLISHED','SUPERSEDED','ARCHIVED') THEN
    RAISE EXCEPTION 'invalid learning certification version transition'
      USING ERRCODE = 'check_violation';
  ELSIF OLD.state = 'SUPERSEDED' AND NEW.state NOT IN ('SUPERSEDED','ARCHIVED') THEN
    RAISE EXCEPTION 'invalid learning certification version transition'
      USING ERRCODE = 'check_violation';
  ELSIF OLD.state = 'ARCHIVED' AND NEW.state <> 'ARCHIVED' THEN
    RAISE EXCEPTION 'archived learning certification versions are terminal'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.state = 'PUBLISHED' AND OLD.state <> 'PUBLISHED' THEN
    SELECT state INTO program_state
      FROM platform.learning_program_versions
     WHERE tenant_id = NEW.tenant_id
       AND program_version_id = NEW.program_version_id;

    IF program_state NOT IN ('PUBLISHED','SUPERSEDED') THEN
      RAISE EXCEPTION 'published certifications require a published program version'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER learning_certification_versions_lifecycle
BEFORE UPDATE OR DELETE ON platform.learning_certification_versions
FOR EACH ROW EXECUTE FUNCTION platform.enforce_learning_certification_version_lifecycle();

CREATE OR REPLACE FUNCTION platform.enforce_learning_credential_binding()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  certification_state text;
  certification_program_version uuid;
  enrollment_state text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.tenant_id IS DISTINCT FROM NEW.tenant_id
       OR OLD.credential_key IS DISTINCT FROM NEW.credential_key
       OR OLD.certification_id IS DISTINCT FROM NEW.certification_id
       OR OLD.certification_version_id IS DISTINCT FROM NEW.certification_version_id
       OR OLD.program_enrollment_id IS DISTINCT FROM NEW.program_enrollment_id
       OR OLD.learner_id IS DISTINCT FROM NEW.learner_id
       OR OLD.program_version_id IS DISTINCT FROM NEW.program_version_id
       OR OLD.issued_at IS DISTINCT FROM NEW.issued_at THEN
      RAISE EXCEPTION 'learning credential identity and issuance are immutable'
        USING ERRCODE = 'check_violation';
    END IF;

    IF OLD.status = 'REVOKED' AND NEW.status <> 'REVOKED' THEN
      RAISE EXCEPTION 'revoked learning credentials are terminal'
        USING ERRCODE = 'check_violation';
    END IF;

    RETURN NEW;
  END IF;

  SELECT state, program_version_id
    INTO certification_state, certification_program_version
    FROM platform.learning_certification_versions
   WHERE tenant_id = NEW.tenant_id
     AND certification_version_id = NEW.certification_version_id
     AND certification_id = NEW.certification_id;

  IF certification_state IS DISTINCT FROM 'PUBLISHED' THEN
    RAISE EXCEPTION 'new learning credentials require a published certification version'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT status INTO enrollment_state
    FROM platform.learning_program_enrollments
   WHERE tenant_id = NEW.tenant_id
     AND program_enrollment_id = NEW.program_enrollment_id
     AND learner_id = NEW.learner_id
     AND program_version_id = NEW.program_version_id;

  IF enrollment_state IS DISTINCT FROM 'COMPLETED' THEN
    RAISE EXCEPTION 'learning credentials require a completed program enrollment'
      USING ERRCODE = 'check_violation';
  END IF;

  IF certification_program_version IS DISTINCT FROM NEW.program_version_id THEN
    RAISE EXCEPTION 'learning credential certification and program versions must match'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER learning_credential_binding
BEFORE INSERT OR UPDATE ON platform.learning_credentials
FOR EACH ROW EXECUTE FUNCTION platform.enforce_learning_credential_binding();

ALTER TABLE platform.learning_programs ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.learning_programs FORCE ROW LEVEL SECURITY;
CREATE POLICY learning_programs_tenant_isolation
  ON platform.learning_programs
  FOR ALL
  USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());

ALTER TABLE platform.learning_program_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.learning_program_versions FORCE ROW LEVEL SECURITY;
CREATE POLICY learning_program_versions_tenant_isolation
  ON platform.learning_program_versions
  FOR ALL
  USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());

ALTER TABLE platform.learning_program_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.learning_program_items FORCE ROW LEVEL SECURITY;
CREATE POLICY learning_program_items_tenant_isolation
  ON platform.learning_program_items
  FOR ALL
  USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());

ALTER TABLE platform.learning_program_enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.learning_program_enrollments FORCE ROW LEVEL SECURITY;
CREATE POLICY learning_program_enrollments_tenant_isolation
  ON platform.learning_program_enrollments
  FOR ALL
  USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());

ALTER TABLE platform.learning_certifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.learning_certifications FORCE ROW LEVEL SECURITY;
CREATE POLICY learning_certifications_tenant_isolation
  ON platform.learning_certifications
  FOR ALL
  USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());

ALTER TABLE platform.learning_certification_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.learning_certification_versions FORCE ROW LEVEL SECURITY;
CREATE POLICY learning_certification_versions_tenant_isolation
  ON platform.learning_certification_versions
  FOR ALL
  USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());

ALTER TABLE platform.learning_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.learning_credentials FORCE ROW LEVEL SECURITY;
CREATE POLICY learning_credentials_tenant_isolation
  ON platform.learning_credentials
  FOR ALL
  USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());

COMMIT;
