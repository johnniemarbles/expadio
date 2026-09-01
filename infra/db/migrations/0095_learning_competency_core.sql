BEGIN;

-- LMS-05 — versioned competency frameworks, cumulative proficiency levels,
-- auditable evidence observations, and effective learner achievement state.

CREATE TABLE platform.learning_competency_frameworks (
  competency_framework_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
  academy_id uuid NOT NULL,
  framework_key text NOT NULL CHECK (
    framework_key ~ '^[a-z0-9]+([._-][a-z0-9]+)*$'
  ),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','ARCHIVED')),
  current_published_version integer CHECK (
    current_published_version IS NULL OR current_published_version > 0
  ),
  created_by_subject_id text NOT NULL CHECK (btrim(created_by_subject_id) <> ''),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (competency_framework_id, tenant_id),
  UNIQUE (tenant_id, framework_key),
  FOREIGN KEY (academy_id, tenant_id)
    REFERENCES platform.learning_academies(academy_id, tenant_id)
    ON DELETE RESTRICT
);

CREATE TABLE platform.learning_competency_framework_versions (
  competency_framework_version_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
  competency_framework_id uuid NOT NULL,
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
  UNIQUE (competency_framework_version_id, tenant_id),
  UNIQUE (
    competency_framework_version_id,
    tenant_id,
    competency_framework_id
  ),
  UNIQUE (competency_framework_id, version),
  FOREIGN KEY (competency_framework_id, tenant_id)
    REFERENCES platform.learning_competency_frameworks(
      competency_framework_id, tenant_id
    )
    ON DELETE CASCADE,
  CONSTRAINT learning_competency_framework_publish_metadata CHECK (
    (published_by_subject_id IS NULL AND published_at IS NULL)
    OR (published_by_subject_id IS NOT NULL AND published_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX learning_competency_framework_one_published_uq
  ON platform.learning_competency_framework_versions(competency_framework_id)
  WHERE state = 'PUBLISHED';

CREATE TABLE platform.learning_competency_definitions (
  competency_definition_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
  competency_framework_version_id uuid NOT NULL,
  competency_key text NOT NULL CHECK (
    competency_key ~ '^[a-z0-9]+([._-][a-z0-9]+)*$'
  ),
  title text NOT NULL CHECK (btrim(title) <> ''),
  description text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (competency_definition_id, tenant_id),
  UNIQUE (competency_framework_version_id, competency_key),
  FOREIGN KEY (competency_framework_version_id, tenant_id)
    REFERENCES platform.learning_competency_framework_versions(
      competency_framework_version_id, tenant_id
    )
    ON DELETE CASCADE
);

CREATE TABLE platform.learning_competency_levels (
  competency_level_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
  competency_definition_id uuid NOT NULL,
  level_key text NOT NULL CHECK (
    level_key ~ '^[a-z0-9]+([._-][a-z0-9]+)*$'
  ),
  name text NOT NULL CHECK (btrim(name) <> ''),
  rank integer NOT NULL CHECK (rank > 0 AND rank <= 1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (competency_level_id, tenant_id),
  UNIQUE (competency_definition_id, level_key),
  UNIQUE (competency_definition_id, rank),
  FOREIGN KEY (competency_definition_id, tenant_id)
    REFERENCES platform.learning_competency_definitions(
      competency_definition_id, tenant_id
    )
    ON DELETE CASCADE
);

CREATE TABLE platform.learning_competency_evidence_rules (
  competency_evidence_rule_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
  competency_level_id uuid NOT NULL,
  evidence_type text NOT NULL CHECK (
    evidence_type IN (
      'COURSE_COMPLETION',
      'ASSESSMENT_PASS',
      'PROGRAM_COMPLETION',
      'CREDENTIAL_ACTIVE'
    )
  ),
  course_version_id uuid,
  assessment_version_id uuid,
  program_version_id uuid,
  certification_version_id uuid,
  required boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (competency_evidence_rule_id, tenant_id),
  FOREIGN KEY (competency_level_id, tenant_id)
    REFERENCES platform.learning_competency_levels(
      competency_level_id, tenant_id
    )
    ON DELETE CASCADE,
  FOREIGN KEY (course_version_id, tenant_id)
    REFERENCES platform.learning_course_versions(course_version_id, tenant_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (assessment_version_id, tenant_id)
    REFERENCES platform.learning_assessment_versions(
      assessment_version_id, tenant_id
    )
    ON DELETE RESTRICT,
  FOREIGN KEY (program_version_id, tenant_id)
    REFERENCES platform.learning_program_versions(program_version_id, tenant_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (certification_version_id, tenant_id)
    REFERENCES platform.learning_certification_versions(
      certification_version_id, tenant_id
    )
    ON DELETE RESTRICT,
  CONSTRAINT learning_competency_evidence_rule_target CHECK (
    (
      evidence_type = 'COURSE_COMPLETION'
      AND course_version_id IS NOT NULL
      AND assessment_version_id IS NULL
      AND program_version_id IS NULL
      AND certification_version_id IS NULL
    )
    OR
    (
      evidence_type = 'ASSESSMENT_PASS'
      AND course_version_id IS NULL
      AND assessment_version_id IS NOT NULL
      AND program_version_id IS NULL
      AND certification_version_id IS NULL
    )
    OR
    (
      evidence_type = 'PROGRAM_COMPLETION'
      AND course_version_id IS NULL
      AND assessment_version_id IS NULL
      AND program_version_id IS NOT NULL
      AND certification_version_id IS NULL
    )
    OR
    (
      evidence_type = 'CREDENTIAL_ACTIVE'
      AND course_version_id IS NULL
      AND assessment_version_id IS NULL
      AND program_version_id IS NULL
      AND certification_version_id IS NOT NULL
    )
  )
);

CREATE UNIQUE INDEX learning_competency_course_rule_uq
  ON platform.learning_competency_evidence_rules(
    competency_level_id, course_version_id
  )
  WHERE course_version_id IS NOT NULL;

CREATE UNIQUE INDEX learning_competency_assessment_rule_uq
  ON platform.learning_competency_evidence_rules(
    competency_level_id, assessment_version_id
  )
  WHERE assessment_version_id IS NOT NULL;

CREATE UNIQUE INDEX learning_competency_program_rule_uq
  ON platform.learning_competency_evidence_rules(
    competency_level_id, program_version_id
  )
  WHERE program_version_id IS NOT NULL;

CREATE UNIQUE INDEX learning_competency_certification_rule_uq
  ON platform.learning_competency_evidence_rules(
    competency_level_id, certification_version_id
  )
  WHERE certification_version_id IS NOT NULL;

CREATE TABLE platform.learning_competency_evidence (
  competency_evidence_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
  learner_id uuid NOT NULL,
  competency_definition_id uuid NOT NULL,
  competency_level_id uuid NOT NULL,
  competency_evidence_rule_id uuid NOT NULL,
  evidence_type text NOT NULL CHECK (
    evidence_type IN (
      'COURSE_COMPLETION',
      'ASSESSMENT_PASS',
      'PROGRAM_COMPLETION',
      'CREDENTIAL_ACTIVE'
    )
  ),
  source_id uuid NOT NULL,
  observed_at timestamptz NOT NULL,
  valid_until timestamptz,
  currently_valid boolean NOT NULL,
  last_verified_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (competency_evidence_id, tenant_id),
  UNIQUE (tenant_id, learner_id, competency_evidence_rule_id),
  FOREIGN KEY (learner_id, tenant_id)
    REFERENCES platform.learning_learners(learner_id, tenant_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (competency_definition_id, tenant_id)
    REFERENCES platform.learning_competency_definitions(
      competency_definition_id, tenant_id
    )
    ON DELETE RESTRICT,
  FOREIGN KEY (competency_level_id, tenant_id)
    REFERENCES platform.learning_competency_levels(
      competency_level_id, tenant_id
    )
    ON DELETE RESTRICT,
  FOREIGN KEY (competency_evidence_rule_id, tenant_id)
    REFERENCES platform.learning_competency_evidence_rules(
      competency_evidence_rule_id, tenant_id
    )
    ON DELETE RESTRICT,
  CONSTRAINT learning_competency_evidence_validity CHECK (
    valid_until IS NULL OR valid_until > observed_at
  )
);

CREATE INDEX learning_competency_evidence_learner_idx
  ON platform.learning_competency_evidence(
    tenant_id, learner_id, competency_definition_id, currently_valid
  );

CREATE TABLE platform.learning_competency_achievements (
  competency_achievement_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
  learner_id uuid NOT NULL,
  competency_definition_id uuid NOT NULL,
  competency_level_id uuid NOT NULL,
  achieved_rank integer NOT NULL CHECK (achieved_rank > 0 AND achieved_rank <= 1000),
  status text NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE','LAPSED')),
  first_achieved_at timestamptz NOT NULL,
  level_achieved_at timestamptz NOT NULL,
  lapsed_at timestamptz,
  last_reconciled_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (competency_achievement_id, tenant_id),
  UNIQUE (tenant_id, learner_id, competency_definition_id),
  FOREIGN KEY (learner_id, tenant_id)
    REFERENCES platform.learning_learners(learner_id, tenant_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (competency_definition_id, tenant_id)
    REFERENCES platform.learning_competency_definitions(
      competency_definition_id, tenant_id
    )
    ON DELETE RESTRICT,
  FOREIGN KEY (competency_level_id, tenant_id)
    REFERENCES platform.learning_competency_levels(
      competency_level_id, tenant_id
    )
    ON DELETE RESTRICT,
  CONSTRAINT learning_competency_achievement_lapse_shape CHECK (
    (status = 'LAPSED' AND lapsed_at IS NOT NULL)
    OR (status = 'ACTIVE' AND lapsed_at IS NULL)
  )
);

CREATE INDEX learning_competency_achievements_learner_idx
  ON platform.learning_competency_achievements(
    tenant_id, learner_id, status, achieved_rank DESC
  );

CREATE OR REPLACE FUNCTION platform.enforce_learning_competency_framework_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.state <> 'DRAFT' THEN
      RAISE EXCEPTION 'non-draft learning competency framework versions are immutable'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.tenant_id IS DISTINCT FROM NEW.tenant_id
     OR OLD.competency_framework_id IS DISTINCT FROM NEW.competency_framework_id
     OR OLD.version IS DISTINCT FROM NEW.version THEN
    RAISE EXCEPTION 'learning competency framework version identity is immutable'
      USING ERRCODE = 'check_violation';
  END IF;

  IF OLD.state <> 'DRAFT' AND (
       OLD.title IS DISTINCT FROM NEW.title
       OR OLD.description IS DISTINCT FROM NEW.description
     ) THEN
    RAISE EXCEPTION 'only draft learning competency framework versions may edit content'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.state = 'PUBLISHED'
     AND (NEW.published_by_subject_id IS NULL OR NEW.published_at IS NULL) THEN
    RAISE EXCEPTION 'published learning competency framework versions require publication provenance'
      USING ERRCODE = 'check_violation';
  END IF;

  IF OLD.state = 'DRAFT' AND NEW.state NOT IN ('DRAFT','PUBLISHED','ARCHIVED') THEN
    RAISE EXCEPTION 'invalid learning competency framework version transition'
      USING ERRCODE = 'check_violation';
  ELSIF OLD.state = 'PUBLISHED' AND NEW.state NOT IN ('PUBLISHED','SUPERSEDED','ARCHIVED') THEN
    RAISE EXCEPTION 'invalid learning competency framework version transition'
      USING ERRCODE = 'check_violation';
  ELSIF OLD.state = 'SUPERSEDED' AND NEW.state NOT IN ('SUPERSEDED','ARCHIVED') THEN
    RAISE EXCEPTION 'invalid learning competency framework version transition'
      USING ERRCODE = 'check_violation';
  ELSIF OLD.state = 'ARCHIVED' AND NEW.state <> 'ARCHIVED' THEN
    RAISE EXCEPTION 'archived learning competency framework versions are terminal'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.state = 'PUBLISHED' AND OLD.state <> 'PUBLISHED' THEN
    IF NOT EXISTS (
      SELECT 1
        FROM platform.learning_competency_definitions definition
       WHERE definition.tenant_id = NEW.tenant_id
         AND definition.competency_framework_version_id =
             NEW.competency_framework_version_id
    ) THEN
      RAISE EXCEPTION 'published competency frameworks require at least one competency'
        USING ERRCODE = 'check_violation';
    END IF;

    IF EXISTS (
      SELECT 1
        FROM platform.learning_competency_definitions definition
       WHERE definition.tenant_id = NEW.tenant_id
         AND definition.competency_framework_version_id =
             NEW.competency_framework_version_id
         AND NOT EXISTS (
           SELECT 1
             FROM platform.learning_competency_levels level
            WHERE level.tenant_id = definition.tenant_id
              AND level.competency_definition_id =
                  definition.competency_definition_id
         )
    ) THEN
      RAISE EXCEPTION 'published competencies require at least one proficiency level'
        USING ERRCODE = 'check_violation';
    END IF;

    IF EXISTS (
      SELECT 1
        FROM platform.learning_competency_levels level
        JOIN platform.learning_competency_definitions definition
          ON definition.competency_definition_id =
             level.competency_definition_id
         AND definition.tenant_id = level.tenant_id
       WHERE definition.tenant_id = NEW.tenant_id
         AND definition.competency_framework_version_id =
             NEW.competency_framework_version_id
         AND NOT EXISTS (
           SELECT 1
             FROM platform.learning_competency_evidence_rules rule
            WHERE rule.tenant_id = level.tenant_id
              AND rule.competency_level_id = level.competency_level_id
              AND rule.required = true
         )
    ) THEN
      RAISE EXCEPTION 'published proficiency levels require required evidence'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER learning_competency_framework_versions_lifecycle
BEFORE UPDATE OR DELETE ON platform.learning_competency_framework_versions
FOR EACH ROW EXECUTE FUNCTION platform.enforce_learning_competency_framework_lifecycle();

CREATE OR REPLACE FUNCTION platform.enforce_learning_competency_child_draft()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  framework_version_id uuid;
  target_tenant uuid;
  parent_state text;
BEGIN
  target_tenant := CASE WHEN TG_OP = 'DELETE' THEN OLD.tenant_id ELSE NEW.tenant_id END;

  IF TG_TABLE_NAME = 'learning_competency_definitions' THEN
    framework_version_id :=
      CASE
        WHEN TG_OP = 'DELETE' THEN OLD.competency_framework_version_id
        ELSE NEW.competency_framework_version_id
      END;
  ELSIF TG_TABLE_NAME = 'learning_competency_levels' THEN
    SELECT definition.competency_framework_version_id
      INTO framework_version_id
      FROM platform.learning_competency_definitions definition
     WHERE definition.tenant_id = target_tenant
       AND definition.competency_definition_id =
           CASE
             WHEN TG_OP = 'DELETE' THEN OLD.competency_definition_id
             ELSE NEW.competency_definition_id
           END;
  ELSE
    SELECT definition.competency_framework_version_id
      INTO framework_version_id
      FROM platform.learning_competency_levels level
      JOIN platform.learning_competency_definitions definition
        ON definition.competency_definition_id =
           level.competency_definition_id
       AND definition.tenant_id = level.tenant_id
     WHERE level.tenant_id = target_tenant
       AND level.competency_level_id =
           CASE
             WHEN TG_OP = 'DELETE' THEN OLD.competency_level_id
             ELSE NEW.competency_level_id
           END;
  END IF;

  IF framework_version_id IS NULL AND TG_OP = 'DELETE' THEN RETURN OLD; END IF;

  SELECT state INTO parent_state
    FROM platform.learning_competency_framework_versions
   WHERE tenant_id = target_tenant
     AND competency_framework_version_id = framework_version_id;

  IF parent_state IS DISTINCT FROM 'DRAFT' THEN
    RAISE EXCEPTION 'competency definitions, levels, and rules may mutate only while framework version is DRAFT'
      USING ERRCODE = 'check_violation';
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER learning_competency_definitions_draft_only
BEFORE INSERT OR UPDATE OR DELETE ON platform.learning_competency_definitions
FOR EACH ROW EXECUTE FUNCTION platform.enforce_learning_competency_child_draft();

CREATE TRIGGER learning_competency_levels_draft_only
BEFORE INSERT OR UPDATE OR DELETE ON platform.learning_competency_levels
FOR EACH ROW EXECUTE FUNCTION platform.enforce_learning_competency_child_draft();

CREATE TRIGGER learning_competency_evidence_rules_draft_only
BEFORE INSERT OR UPDATE OR DELETE ON platform.learning_competency_evidence_rules
FOR EACH ROW EXECUTE FUNCTION platform.enforce_learning_competency_child_draft();

CREATE OR REPLACE FUNCTION platform.enforce_learning_competency_evidence_identity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.tenant_id IS DISTINCT FROM NEW.tenant_id
     OR OLD.learner_id IS DISTINCT FROM NEW.learner_id
     OR OLD.competency_definition_id IS DISTINCT FROM NEW.competency_definition_id
     OR OLD.competency_level_id IS DISTINCT FROM NEW.competency_level_id
     OR OLD.competency_evidence_rule_id IS DISTINCT FROM NEW.competency_evidence_rule_id
     OR OLD.evidence_type IS DISTINCT FROM NEW.evidence_type
     OR OLD.source_id IS DISTINCT FROM NEW.source_id
     OR OLD.observed_at IS DISTINCT FROM NEW.observed_at THEN
    RAISE EXCEPTION 'learning competency evidence identity and observation are immutable'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER learning_competency_evidence_identity
BEFORE UPDATE ON platform.learning_competency_evidence
FOR EACH ROW EXECUTE FUNCTION platform.enforce_learning_competency_evidence_identity();

ALTER TABLE platform.learning_competency_frameworks ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.learning_competency_frameworks FORCE ROW LEVEL SECURITY;
CREATE POLICY learning_competency_frameworks_tenant_isolation
  ON platform.learning_competency_frameworks
  FOR ALL
  USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());

ALTER TABLE platform.learning_competency_framework_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.learning_competency_framework_versions FORCE ROW LEVEL SECURITY;
CREATE POLICY learning_competency_framework_versions_tenant_isolation
  ON platform.learning_competency_framework_versions
  FOR ALL
  USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());

ALTER TABLE platform.learning_competency_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.learning_competency_definitions FORCE ROW LEVEL SECURITY;
CREATE POLICY learning_competency_definitions_tenant_isolation
  ON platform.learning_competency_definitions
  FOR ALL
  USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());

ALTER TABLE platform.learning_competency_levels ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.learning_competency_levels FORCE ROW LEVEL SECURITY;
CREATE POLICY learning_competency_levels_tenant_isolation
  ON platform.learning_competency_levels
  FOR ALL
  USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());

ALTER TABLE platform.learning_competency_evidence_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.learning_competency_evidence_rules FORCE ROW LEVEL SECURITY;
CREATE POLICY learning_competency_evidence_rules_tenant_isolation
  ON platform.learning_competency_evidence_rules
  FOR ALL
  USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());

ALTER TABLE platform.learning_competency_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.learning_competency_evidence FORCE ROW LEVEL SECURITY;
CREATE POLICY learning_competency_evidence_tenant_isolation
  ON platform.learning_competency_evidence
  FOR ALL
  USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());

ALTER TABLE platform.learning_competency_achievements ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.learning_competency_achievements FORCE ROW LEVEL SECURITY;
CREATE POLICY learning_competency_achievements_tenant_isolation
  ON platform.learning_competency_achievements
  FOR ALL
  USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());

COMMIT;
