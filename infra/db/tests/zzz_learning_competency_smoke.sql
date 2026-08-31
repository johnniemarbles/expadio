\set ON_ERROR_STOP on

INSERT INTO platform.tenants (tenant_id, name) VALUES
  ('91919191-9191-4191-8191-919191919191', 'Competency Smoke A'),
  ('92929292-9292-4292-8292-929292929292', 'Competency Smoke B');

INSERT INTO platform.tenant_modules (
  tenant_id, module_key, status, activation_requested_by_subject_id,
  activated_by_subject_id, activated_at
) VALUES
  ('91919191-9191-4191-8191-919191919191', 'learning', 'ACTIVE', 'admin-a', 'admin-a', now()),
  ('92929292-9292-4292-8292-929292929292', 'learning', 'ACTIVE', 'admin-b', 'admin-b', now());

INSERT INTO platform.learning_academies (
  tenant_id, tenant_module_id, name, slug, is_default
)
SELECT tenant_id, tenant_module_id,
       CASE WHEN tenant_id = '91919191-9191-4191-8191-919191919191'::uuid
            THEN 'Competency Academy A' ELSE 'Competency Academy B' END,
       'competency-academy', true
  FROM platform.tenant_modules
 WHERE tenant_id IN (
   '91919191-9191-4191-8191-919191919191'::uuid,
   '92929292-9292-4292-8292-929292929292'::uuid
 );

INSERT INTO platform.learning_courses (
  tenant_id, academy_id, course_key, created_by_subject_id
)
SELECT tenant_id, academy_id, 'competency.smoke.course', 'smoke-admin'
  FROM platform.learning_academies
 WHERE tenant_id IN (
   '91919191-9191-4191-8191-919191919191'::uuid,
   '92929292-9292-4292-8292-929292929292'::uuid
 );

INSERT INTO platform.learning_course_versions (
  tenant_id, course_id, version, state, title, language, learning_objectives,
  created_by_subject_id, updated_by_subject_id
)
SELECT tenant_id, course_id, 1, 'DRAFT', 'Competency Smoke Course', 'en',
       '["Demonstrate competency"]'::jsonb, 'smoke-admin', 'smoke-admin'
  FROM platform.learning_courses
 WHERE tenant_id IN (
   '91919191-9191-4191-8191-919191919191'::uuid,
   '92929292-9292-4292-8292-929292929292'::uuid
 );

INSERT INTO platform.learning_course_modules (
  tenant_id, course_version_id, module_key, title, position
)
SELECT tenant_id, course_version_id, 'module', 'Module', 1
  FROM platform.learning_course_versions
 WHERE tenant_id IN (
   '91919191-9191-4191-8191-919191919191'::uuid,
   '92929292-9292-4292-8292-929292929292'::uuid
 );

INSERT INTO platform.learning_lessons (
  tenant_id, course_version_id, course_module_id, lesson_key, title,
  activity_type, position, required, content
)
SELECT tenant_id, course_version_id, course_module_id, 'lesson', 'Lesson',
       'TEXT', 1, true, '{}'::jsonb
  FROM platform.learning_course_modules
 WHERE tenant_id IN (
   '91919191-9191-4191-8191-919191919191'::uuid,
   '92929292-9292-4292-8292-929292929292'::uuid
 );

UPDATE platform.learning_course_versions
   SET state = 'PUBLISHED',
       published_by_subject_id = 'smoke-admin',
       published_at = now(),
       updated_by_subject_id = 'smoke-admin',
       updated_at = now()
 WHERE tenant_id IN (
   '91919191-9191-4191-8191-919191919191'::uuid,
   '92929292-9292-4292-8292-929292929292'::uuid
 );

UPDATE platform.learning_courses
   SET current_published_version = 1,
       updated_at = now()
 WHERE tenant_id IN (
   '91919191-9191-4191-8191-919191919191'::uuid,
   '92929292-9292-4292-8292-929292929292'::uuid
 );

INSERT INTO platform.learning_learners (
  tenant_id, external_ref, full_name, audience_type, created_by_subject_id
) VALUES
  ('91919191-9191-4191-8191-919191919191', 'competency-smoke-a', 'Learner A', 'EXTERNAL', 'smoke-admin'),
  ('92929292-9292-4292-8292-929292929292', 'competency-smoke-b', 'Learner B', 'EXTERNAL', 'smoke-admin');

INSERT INTO platform.learning_enrollments (
  tenant_id, learner_id, course_id, course_version_id, assignment_key,
  source_type, assigned_by_subject_id, status, started_at, completed_at,
  completion_percent
)
SELECT learner.tenant_id, learner.learner_id, course.course_id,
       version.course_version_id,
       'competency-smoke:' || learner.external_ref,
       'MANUAL', 'smoke-admin', 'COMPLETED', now(), now(), 100
  FROM platform.learning_learners learner
  JOIN platform.learning_courses course
    ON course.tenant_id = learner.tenant_id
  JOIN platform.learning_course_versions version
    ON version.tenant_id = course.tenant_id
   AND version.course_id = course.course_id
   AND version.version = 1
 WHERE learner.tenant_id IN (
   '91919191-9191-4191-8191-919191919191'::uuid,
   '92929292-9292-4292-8292-929292929292'::uuid
 );

INSERT INTO platform.learning_competency_frameworks (
  tenant_id, academy_id, framework_key, created_by_subject_id
)
SELECT tenant_id, academy_id, 'competency.smoke.framework', 'smoke-admin'
  FROM platform.learning_academies
 WHERE tenant_id IN (
   '91919191-9191-4191-8191-919191919191'::uuid,
   '92929292-9292-4292-8292-929292929292'::uuid
 );

INSERT INTO platform.learning_competency_framework_versions (
  tenant_id, competency_framework_id, version, state, title, description,
  created_by_subject_id, updated_by_subject_id
)
SELECT tenant_id, competency_framework_id, 1, 'DRAFT',
       'Competency Smoke Framework', 'Pinned course evidence.',
       'smoke-admin', 'smoke-admin'
  FROM platform.learning_competency_frameworks
 WHERE tenant_id IN (
   '91919191-9191-4191-8191-919191919191'::uuid,
   '92929292-9292-4292-8292-929292929292'::uuid
 );

INSERT INTO platform.learning_competency_definitions (
  tenant_id, competency_framework_version_id, competency_key, title, description
)
SELECT tenant_id, competency_framework_version_id,
       'privacy.practice', 'Privacy Practice', 'Smoke competency.'
  FROM platform.learning_competency_framework_versions
 WHERE tenant_id IN (
   '91919191-9191-4191-8191-919191919191'::uuid,
   '92929292-9292-4292-8292-929292929292'::uuid
 );

INSERT INTO platform.learning_competency_levels (
  tenant_id, competency_definition_id, level_key, name, rank
)
SELECT tenant_id, competency_definition_id, 'aware', 'Aware', 1
  FROM platform.learning_competency_definitions
 WHERE tenant_id IN (
   '91919191-9191-4191-8191-919191919191'::uuid,
   '92929292-9292-4292-8292-929292929292'::uuid
 );

INSERT INTO platform.learning_competency_evidence_rules (
  tenant_id, competency_level_id, evidence_type, course_version_id, required
)
SELECT level.tenant_id, level.competency_level_id, 'COURSE_COMPLETION',
       version.course_version_id, true
  FROM platform.learning_competency_levels level
  JOIN platform.learning_competency_definitions definition
    ON definition.competency_definition_id = level.competency_definition_id
   AND definition.tenant_id = level.tenant_id
  JOIN platform.learning_competency_framework_versions framework_version
    ON framework_version.competency_framework_version_id =
       definition.competency_framework_version_id
   AND framework_version.tenant_id = level.tenant_id
  JOIN platform.learning_competency_frameworks framework
    ON framework.competency_framework_id =
       framework_version.competency_framework_id
   AND framework.tenant_id = level.tenant_id
  JOIN platform.learning_courses course
    ON course.tenant_id = level.tenant_id
  JOIN platform.learning_course_versions version
    ON version.tenant_id = course.tenant_id
   AND version.course_id = course.course_id
   AND version.version = 1
 WHERE level.tenant_id IN (
   '91919191-9191-4191-8191-919191919191'::uuid,
   '92929292-9292-4292-8292-929292929292'::uuid
 );

UPDATE platform.learning_competency_framework_versions
   SET state = 'PUBLISHED',
       published_by_subject_id = 'smoke-admin',
       published_at = now(),
       updated_by_subject_id = 'smoke-admin',
       updated_at = now()
 WHERE tenant_id IN (
   '91919191-9191-4191-8191-919191919191'::uuid,
   '92929292-9292-4292-8292-929292929292'::uuid
 );

UPDATE platform.learning_competency_frameworks
   SET current_published_version = 1,
       updated_at = now()
 WHERE tenant_id IN (
   '91919191-9191-4191-8191-919191919191'::uuid,
   '92929292-9292-4292-8292-929292929292'::uuid
 );

INSERT INTO platform.learning_competency_evidence (
  tenant_id, learner_id, competency_definition_id, competency_level_id,
  competency_evidence_rule_id, evidence_type, source_id, observed_at,
  currently_valid, last_verified_at
)
SELECT learner.tenant_id, learner.learner_id,
       definition.competency_definition_id, level.competency_level_id,
       rule.competency_evidence_rule_id, 'COURSE_COMPLETION',
       enrollment.enrollment_id, enrollment.completed_at, true, now()
  FROM platform.learning_learners learner
  JOIN platform.learning_enrollments enrollment
    ON enrollment.tenant_id = learner.tenant_id
   AND enrollment.learner_id = learner.learner_id
  JOIN platform.learning_competency_definitions definition
    ON definition.tenant_id = learner.tenant_id
  JOIN platform.learning_competency_levels level
    ON level.tenant_id = definition.tenant_id
   AND level.competency_definition_id = definition.competency_definition_id
  JOIN platform.learning_competency_evidence_rules rule
    ON rule.tenant_id = level.tenant_id
   AND rule.competency_level_id = level.competency_level_id
 WHERE learner.tenant_id IN (
   '91919191-9191-4191-8191-919191919191'::uuid,
   '92929292-9292-4292-8292-929292929292'::uuid
 );

INSERT INTO platform.learning_competency_achievements (
  tenant_id, learner_id, competency_definition_id, competency_level_id,
  achieved_rank, status, first_achieved_at, level_achieved_at,
  last_reconciled_at
)
SELECT learner.tenant_id, learner.learner_id,
       definition.competency_definition_id, level.competency_level_id,
       level.rank, 'ACTIVE', now(), now(), now()
  FROM platform.learning_learners learner
  JOIN platform.learning_competency_definitions definition
    ON definition.tenant_id = learner.tenant_id
  JOIN platform.learning_competency_levels level
    ON level.tenant_id = definition.tenant_id
   AND level.competency_definition_id = definition.competency_definition_id
 WHERE learner.tenant_id IN (
   '91919191-9191-4191-8191-919191919191'::uuid,
   '92929292-9292-4292-8292-929292929292'::uuid
 );

DO $$
DECLARE
  framework_version uuid;
  rule_id uuid;
  evidence_id uuid;
BEGIN
  SELECT competency_framework_version_id INTO framework_version
    FROM platform.learning_competency_framework_versions
   WHERE tenant_id = '91919191-9191-4191-8191-919191919191'::uuid
     AND version = 1;

  BEGIN
    UPDATE platform.learning_competency_framework_versions
       SET title = 'Tampered Framework'
     WHERE competency_framework_version_id = framework_version;
    RAISE EXCEPTION 'published framework mutation unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'published framework mutation unexpectedly succeeded' THEN RAISE; END IF;
    IF POSITION('only draft learning competency framework versions may edit content' IN SQLERRM) = 0 THEN RAISE; END IF;
  END;

  SELECT rule.competency_evidence_rule_id INTO rule_id
    FROM platform.learning_competency_evidence_rules rule
    JOIN platform.learning_competency_levels level
      ON level.competency_level_id = rule.competency_level_id
     AND level.tenant_id = rule.tenant_id
    JOIN platform.learning_competency_definitions definition
      ON definition.competency_definition_id = level.competency_definition_id
     AND definition.tenant_id = level.tenant_id
   WHERE rule.tenant_id = '91919191-9191-4191-8191-919191919191'::uuid;

  BEGIN
    DELETE FROM platform.learning_competency_evidence_rules
     WHERE competency_evidence_rule_id = rule_id;
    RAISE EXCEPTION 'published evidence rule delete unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'published evidence rule delete unexpectedly succeeded' THEN RAISE; END IF;
    IF POSITION('may mutate only while framework version is DRAFT' IN SQLERRM) = 0 THEN RAISE; END IF;
  END;

  SELECT competency_evidence_id INTO evidence_id
    FROM platform.learning_competency_evidence
   WHERE tenant_id = '91919191-9191-4191-8191-919191919191'::uuid;

  BEGIN
    UPDATE platform.learning_competency_evidence
       SET source_id = gen_random_uuid()
     WHERE competency_evidence_id = evidence_id;
    RAISE EXCEPTION 'competency evidence identity mutation unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'competency evidence identity mutation unexpectedly succeeded' THEN RAISE; END IF;
    IF POSITION('evidence identity and observation are immutable' IN SQLERRM) = 0 THEN RAISE; END IF;
  END;
END;
$$;

DROP ROLE IF EXISTS expadio_learning_competency_smoke;
CREATE ROLE expadio_learning_competency_smoke NOLOGIN;
GRANT USAGE ON SCHEMA platform TO expadio_learning_competency_smoke;
GRANT SELECT ON
  platform.learning_competency_frameworks,
  platform.learning_competency_framework_versions,
  platform.learning_competency_definitions,
  platform.learning_competency_levels,
  platform.learning_competency_evidence_rules,
  platform.learning_competency_evidence,
  platform.learning_competency_achievements
TO expadio_learning_competency_smoke;

SET ROLE expadio_learning_competency_smoke;
SELECT set_config('app.tenant_id', '91919191-9191-4191-8191-919191919191', false);

DO $$
DECLARE
  framework_count integer;
  definition_count integer;
  level_count integer;
  rule_count integer;
  evidence_count integer;
  achievement_count integer;
BEGIN
  SELECT count(*) INTO framework_count FROM platform.learning_competency_frameworks;
  SELECT count(*) INTO definition_count FROM platform.learning_competency_definitions;
  SELECT count(*) INTO level_count FROM platform.learning_competency_levels;
  SELECT count(*) INTO rule_count FROM platform.learning_competency_evidence_rules;
  SELECT count(*) INTO evidence_count FROM platform.learning_competency_evidence;
  SELECT count(*) INTO achievement_count FROM platform.learning_competency_achievements;

  IF framework_count <> 1 THEN RAISE EXCEPTION 'tenant A expected one framework, got %', framework_count; END IF;
  IF definition_count <> 1 THEN RAISE EXCEPTION 'tenant A expected one competency, got %', definition_count; END IF;
  IF level_count <> 1 THEN RAISE EXCEPTION 'tenant A expected one level, got %', level_count; END IF;
  IF rule_count <> 1 THEN RAISE EXCEPTION 'tenant A expected one rule, got %', rule_count; END IF;
  IF evidence_count <> 1 THEN RAISE EXCEPTION 'tenant A expected one evidence row, got %', evidence_count; END IF;
  IF achievement_count <> 1 THEN RAISE EXCEPTION 'tenant A expected one achievement, got %', achievement_count; END IF;
END;
$$;

RESET ROLE;

SELECT 'learning competency smoke: ok' AS result;
