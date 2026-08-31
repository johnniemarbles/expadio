BEGIN;

-- LMS-01 — versioned course authoring.
-- Published learning content is immutable. A course is a stable tenant identity;
-- modules and lessons belong to a numbered course version.

CREATE TABLE platform.learning_courses (
  course_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
  academy_id uuid NOT NULL,
  course_key text NOT NULL CHECK (course_key ~ '^[a-z0-9]+([._-][a-z0-9]+)*$'),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','ARCHIVED')),
  current_published_version integer CHECK (
    current_published_version IS NULL OR current_published_version > 0
  ),
  created_by_subject_id text NOT NULL CHECK (btrim(created_by_subject_id) <> ''),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (course_id, tenant_id),
  UNIQUE (tenant_id, course_key),
  FOREIGN KEY (academy_id, tenant_id)
    REFERENCES platform.learning_academies(academy_id, tenant_id)
    ON DELETE RESTRICT
);

CREATE INDEX learning_courses_academy_idx
  ON platform.learning_courses (tenant_id, academy_id, status, course_key);

CREATE TABLE platform.learning_course_versions (
  course_version_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
  course_id uuid NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  state text NOT NULL DEFAULT 'DRAFT'
    CHECK (state IN ('DRAFT','IN_REVIEW','PUBLISHED','SUPERSEDED','ARCHIVED')),
  title text NOT NULL CHECK (btrim(title) <> ''),
  summary text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  language text NOT NULL DEFAULT 'en' CHECK (btrim(language) <> ''),
  visibility text NOT NULL DEFAULT 'TENANT'
    CHECK (visibility IN ('PRIVATE','TENANT','PUBLIC')),
  estimated_minutes integer CHECK (estimated_minutes IS NULL OR estimated_minutes > 0),
  learning_objectives jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(learning_objectives) = 'array'),
  created_by_subject_id text NOT NULL CHECK (btrim(created_by_subject_id) <> ''),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by_subject_id text NOT NULL CHECK (btrim(updated_by_subject_id) <> ''),
  updated_at timestamptz NOT NULL DEFAULT now(),
  published_by_subject_id text,
  published_at timestamptz,
  UNIQUE (course_version_id, tenant_id),
  UNIQUE (course_id, version),
  FOREIGN KEY (course_id, tenant_id)
    REFERENCES platform.learning_courses(course_id, tenant_id)
    ON DELETE CASCADE,
  CONSTRAINT learning_course_version_publish_metadata CHECK (
    (published_by_subject_id IS NULL AND published_at IS NULL)
    OR
    (published_by_subject_id IS NOT NULL AND published_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX learning_course_one_published_uq
  ON platform.learning_course_versions (course_id)
  WHERE state = 'PUBLISHED';

CREATE INDEX learning_course_versions_lookup_idx
  ON platform.learning_course_versions (tenant_id, course_id, version DESC);

CREATE TABLE platform.learning_course_modules (
  course_module_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
  course_version_id uuid NOT NULL,
  module_key text NOT NULL CHECK (module_key ~ '^[a-z0-9]+([._-][a-z0-9]+)*$'),
  title text NOT NULL CHECK (btrim(title) <> ''),
  position integer NOT NULL CHECK (position > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (course_module_id, tenant_id),
  UNIQUE (course_version_id, module_key),
  UNIQUE (course_version_id, position),
  FOREIGN KEY (course_version_id, tenant_id)
    REFERENCES platform.learning_course_versions(course_version_id, tenant_id)
    ON DELETE CASCADE
);

CREATE TABLE platform.learning_lessons (
  lesson_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
  course_version_id uuid NOT NULL,
  course_module_id uuid NOT NULL,
  lesson_key text NOT NULL CHECK (lesson_key ~ '^[a-z0-9]+([._-][a-z0-9]+)*$'),
  title text NOT NULL CHECK (btrim(title) <> ''),
  activity_type text NOT NULL
    CHECK (activity_type IN (
      'TEXT','VIDEO','AUDIO','DOCUMENT','PRESENTATION','INTERACTIVE',
      'QUIZ','EXAM','ASSIGNMENT','SURVEY','DISCUSSION','LIVE_SESSION',
      'PRACTICAL_ASSESSMENT','EXTERNAL'
    )),
  position integer NOT NULL CHECK (position > 0),
  required boolean NOT NULL DEFAULT true,
  estimated_minutes integer CHECK (estimated_minutes IS NULL OR estimated_minutes > 0),
  content jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(content) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (lesson_id, tenant_id),
  UNIQUE (course_module_id, lesson_key),
  UNIQUE (course_module_id, position),
  FOREIGN KEY (course_version_id, tenant_id)
    REFERENCES platform.learning_course_versions(course_version_id, tenant_id)
    ON DELETE CASCADE,
  FOREIGN KEY (course_module_id, tenant_id)
    REFERENCES platform.learning_course_modules(course_module_id, tenant_id)
    ON DELETE CASCADE
);

CREATE INDEX learning_lessons_version_module_idx
  ON platform.learning_lessons (tenant_id, course_version_id, course_module_id, position);

CREATE OR REPLACE FUNCTION platform.enforce_learning_course_version_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.state <> 'DRAFT' THEN
      RAISE EXCEPTION 'non-draft learning course versions are immutable'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.tenant_id IS DISTINCT FROM NEW.tenant_id
     OR OLD.course_id IS DISTINCT FROM NEW.course_id
     OR OLD.version IS DISTINCT FROM NEW.version
     OR OLD.created_by_subject_id IS DISTINCT FROM NEW.created_by_subject_id
     OR OLD.created_at IS DISTINCT FROM NEW.created_at THEN
    RAISE EXCEPTION 'learning course version identity/provenance is immutable'
      USING ERRCODE = 'check_violation';
  END IF;

  IF OLD.state <> 'DRAFT' AND (
       OLD.title IS DISTINCT FROM NEW.title
       OR OLD.summary IS DISTINCT FROM NEW.summary
       OR OLD.description IS DISTINCT FROM NEW.description
       OR OLD.language IS DISTINCT FROM NEW.language
       OR OLD.visibility IS DISTINCT FROM NEW.visibility
       OR OLD.estimated_minutes IS DISTINCT FROM NEW.estimated_minutes
       OR OLD.learning_objectives IS DISTINCT FROM NEW.learning_objectives
     ) THEN
    RAISE EXCEPTION 'only draft learning course versions may edit content'
      USING ERRCODE = 'check_violation';
  END IF;

  IF OLD.state = 'DRAFT' AND NEW.state NOT IN ('DRAFT','IN_REVIEW','PUBLISHED','ARCHIVED') THEN
    RAISE EXCEPTION 'invalid learning course version transition'
      USING ERRCODE = 'check_violation';
  ELSIF OLD.state = 'IN_REVIEW' AND NEW.state NOT IN ('IN_REVIEW','DRAFT','PUBLISHED','ARCHIVED') THEN
    RAISE EXCEPTION 'invalid learning course version transition'
      USING ERRCODE = 'check_violation';
  ELSIF OLD.state = 'PUBLISHED' AND NEW.state NOT IN ('PUBLISHED','SUPERSEDED','ARCHIVED') THEN
    RAISE EXCEPTION 'invalid learning course version transition'
      USING ERRCODE = 'check_violation';
  ELSIF OLD.state = 'SUPERSEDED' AND NEW.state NOT IN ('SUPERSEDED','ARCHIVED') THEN
    RAISE EXCEPTION 'invalid learning course version transition'
      USING ERRCODE = 'check_violation';
  ELSIF OLD.state = 'ARCHIVED' AND NEW.state <> 'ARCHIVED' THEN
    RAISE EXCEPTION 'archived learning course versions are terminal'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.state = 'PUBLISHED'
     AND (NEW.published_by_subject_id IS NULL OR NEW.published_at IS NULL) THEN
    RAISE EXCEPTION 'published learning course versions require publication provenance'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.state = 'PUBLISHED' AND OLD.state <> 'PUBLISHED' THEN
    IF jsonb_array_length(NEW.learning_objectives) = 0 THEN
      RAISE EXCEPTION 'published learning course versions require learning objectives'
        USING ERRCODE = 'check_violation';
    END IF;

    IF NOT EXISTS (
      SELECT 1
        FROM platform.learning_course_modules m
       WHERE m.course_version_id = NEW.course_version_id
         AND m.tenant_id = NEW.tenant_id
    ) THEN
      RAISE EXCEPTION 'published learning course versions require at least one module'
        USING ERRCODE = 'check_violation';
    END IF;

    IF EXISTS (
      SELECT 1
        FROM platform.learning_course_modules m
       WHERE m.course_version_id = NEW.course_version_id
         AND m.tenant_id = NEW.tenant_id
         AND NOT EXISTS (
           SELECT 1
             FROM platform.learning_lessons l
            WHERE l.course_module_id = m.course_module_id
              AND l.tenant_id = NEW.tenant_id
         )
    ) THEN
      RAISE EXCEPTION 'published learning course modules require at least one lesson'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER learning_course_versions_lifecycle
BEFORE UPDATE OR DELETE ON platform.learning_course_versions
FOR EACH ROW EXECUTE FUNCTION platform.enforce_learning_course_version_lifecycle();

CREATE OR REPLACE FUNCTION platform.enforce_learning_draft_child_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_version_id uuid;
  target_tenant_id uuid;
  parent_state text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    target_version_id := OLD.course_version_id;
    target_tenant_id := OLD.tenant_id;
  ELSE
    target_version_id := NEW.course_version_id;
    target_tenant_id := NEW.tenant_id;
  END IF;

  SELECT state INTO parent_state
    FROM platform.learning_course_versions
   WHERE course_version_id = target_version_id
     AND tenant_id = target_tenant_id;

  IF parent_state IS NULL AND TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  IF parent_state IS DISTINCT FROM 'DRAFT' THEN
    RAISE EXCEPTION 'learning modules and lessons may mutate only while course version is DRAFT'
      USING ERRCODE = 'check_violation';
  END IF;

  IF TG_OP = 'UPDATE' AND (
       OLD.course_version_id IS DISTINCT FROM NEW.course_version_id
       OR OLD.tenant_id IS DISTINCT FROM NEW.tenant_id
     ) THEN
    RAISE EXCEPTION 'learning child version identity is immutable'
      USING ERRCODE = 'check_violation';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$;

CREATE TRIGGER learning_course_modules_draft_only
BEFORE INSERT OR UPDATE OR DELETE ON platform.learning_course_modules
FOR EACH ROW EXECUTE FUNCTION platform.enforce_learning_draft_child_mutation();

CREATE TRIGGER learning_lessons_draft_only
BEFORE INSERT OR UPDATE OR DELETE ON platform.learning_lessons
FOR EACH ROW EXECUTE FUNCTION platform.enforce_learning_draft_child_mutation();

ALTER TABLE platform.learning_courses ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.learning_courses FORCE ROW LEVEL SECURITY;
CREATE POLICY learning_courses_tenant_isolation
  ON platform.learning_courses
  FOR ALL
  USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());

ALTER TABLE platform.learning_course_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.learning_course_versions FORCE ROW LEVEL SECURITY;
CREATE POLICY learning_course_versions_tenant_isolation
  ON platform.learning_course_versions
  FOR ALL
  USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());

ALTER TABLE platform.learning_course_modules ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.learning_course_modules FORCE ROW LEVEL SECURITY;
CREATE POLICY learning_course_modules_tenant_isolation
  ON platform.learning_course_modules
  FOR ALL
  USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());

ALTER TABLE platform.learning_lessons ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.learning_lessons FORCE ROW LEVEL SECURITY;
CREATE POLICY learning_lessons_tenant_isolation
  ON platform.learning_lessons
  FOR ALL
  USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());

COMMIT;
