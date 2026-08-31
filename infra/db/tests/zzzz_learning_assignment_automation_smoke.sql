\set ON_ERROR_STOP on

INSERT INTO platform.tenants (tenant_id, name) VALUES
  ('93939393-9393-4393-8393-939393939393', 'Assignment Smoke A'),
  ('94949494-9494-4494-8494-949494949494', 'Assignment Smoke B');

INSERT INTO platform.tenant_modules (
  tenant_id, module_key, status, activation_requested_by_subject_id,
  activated_by_subject_id, activated_at
) VALUES
  ('93939393-9393-4393-8393-939393939393', 'learning', 'ACTIVE', 'admin-a', 'admin-a', now()),
  ('94949494-9494-4494-8494-949494949494', 'learning', 'ACTIVE', 'admin-b', 'admin-b', now());

INSERT INTO platform.learning_academies (
  tenant_id, tenant_module_id, name, slug, is_default
)
SELECT tenant_id, tenant_module_id,
       CASE WHEN tenant_id = '93939393-9393-4393-8393-939393939393'::uuid
            THEN 'Assignment Academy A' ELSE 'Assignment Academy B' END,
       'assignment-academy', true
  FROM platform.tenant_modules
 WHERE tenant_id IN (
   '93939393-9393-4393-8393-939393939393'::uuid,
   '94949494-9494-4494-8494-949494949494'::uuid
 );

INSERT INTO platform.learning_courses (
  tenant_id, academy_id, course_key, created_by_subject_id
)
SELECT tenant_id, academy_id, 'assignment.smoke.course', 'smoke-admin'
  FROM platform.learning_academies
 WHERE tenant_id IN (
   '93939393-9393-4393-8393-939393939393'::uuid,
   '94949494-9494-4494-8494-949494949494'::uuid
 );

INSERT INTO platform.learning_course_versions (
  tenant_id, course_id, version, state, title, language, learning_objectives,
  created_by_subject_id, updated_by_subject_id
)
SELECT tenant_id, course_id, 1, 'DRAFT', 'Assignment Smoke Course', 'en',
       '["Complete onboarding"]'::jsonb, 'smoke-admin', 'smoke-admin'
  FROM platform.learning_courses
 WHERE tenant_id IN (
   '93939393-9393-4393-8393-939393939393'::uuid,
   '94949494-9494-4494-8494-949494949494'::uuid
 );

INSERT INTO platform.learning_course_modules (
  tenant_id, course_version_id, module_key, title, position
)
SELECT tenant_id, course_version_id, 'module', 'Module', 1
  FROM platform.learning_course_versions
 WHERE tenant_id IN (
   '93939393-9393-4393-8393-939393939393'::uuid,
   '94949494-9494-4494-8494-949494949494'::uuid
 );

INSERT INTO platform.learning_lessons (
  tenant_id, course_version_id, course_module_id, lesson_key, title,
  activity_type, position, required, content
)
SELECT tenant_id, course_version_id, course_module_id, 'lesson', 'Lesson',
       'TEXT', 1, true, '{}'::jsonb
  FROM platform.learning_course_modules
 WHERE tenant_id IN (
   '93939393-9393-4393-8393-939393939393'::uuid,
   '94949494-9494-4494-8494-949494949494'::uuid
 );

UPDATE platform.learning_course_versions
   SET state = 'PUBLISHED',
       published_by_subject_id = 'smoke-admin',
       published_at = now(),
       updated_by_subject_id = 'smoke-admin',
       updated_at = now()
 WHERE tenant_id IN (
   '93939393-9393-4393-8393-939393939393'::uuid,
   '94949494-9494-4494-8494-949494949494'::uuid
 );

UPDATE platform.learning_courses
   SET current_published_version = 1,
       updated_at = now()
 WHERE tenant_id IN (
   '93939393-9393-4393-8393-939393939393'::uuid,
   '94949494-9494-4494-8494-949494949494'::uuid
 );

INSERT INTO platform.learning_learners (
  tenant_id, external_ref, full_name, audience_type, metadata,
  created_by_subject_id
) VALUES
  ('93939393-9393-4393-8393-939393939393', 'assignment-a', 'Learner A', 'INTERNAL', '{"region":"ON"}', 'smoke-admin'),
  ('94949494-9494-4494-8494-949494949494', 'assignment-b', 'Learner B', 'INTERNAL', '{"region":"ON"}', 'smoke-admin');

INSERT INTO platform.learning_assignment_rules (
  tenant_id, academy_id, rule_key, created_by_subject_id
)
SELECT tenant_id, academy_id, 'assignment.smoke.internal', 'smoke-admin'
  FROM platform.learning_academies
 WHERE tenant_id IN (
   '93939393-9393-4393-8393-939393939393'::uuid,
   '94949494-9494-4494-8494-949494949494'::uuid
 );

INSERT INTO platform.learning_assignment_rule_versions (
  tenant_id, assignment_rule_id, version, state, name, target_type,
  course_id, conditions, created_by_subject_id, updated_by_subject_id
)
SELECT rule.tenant_id, rule.assignment_rule_id, 1, 'DRAFT',
       'Internal Ontario onboarding', 'COURSE', course.course_id,
       '{"audienceTypes":["INTERNAL"],"subjectRequired":false,"metadataEquals":{"region":"ON"}}'::jsonb,
       'smoke-admin', 'smoke-admin'
  FROM platform.learning_assignment_rules rule
  JOIN platform.learning_courses course
    ON course.tenant_id = rule.tenant_id
 WHERE rule.tenant_id IN (
   '93939393-9393-4393-8393-939393939393'::uuid,
   '94949494-9494-4494-8494-949494949494'::uuid
 );

UPDATE platform.learning_assignment_rule_versions
   SET state = 'PUBLISHED',
       published_by_subject_id = 'smoke-admin',
       published_at = now(),
       updated_by_subject_id = 'smoke-admin',
       updated_at = now()
 WHERE tenant_id IN (
   '93939393-9393-4393-8393-939393939393'::uuid,
   '94949494-9494-4494-8494-949494949494'::uuid
 );

UPDATE platform.learning_assignment_rules
   SET current_published_version = 1,
       updated_at = now()
 WHERE tenant_id IN (
   '93939393-9393-4393-8393-939393939393'::uuid,
   '94949494-9494-4494-8494-949494949494'::uuid
 );

INSERT INTO platform.learning_enrollments (
  tenant_id, learner_id, course_id, course_version_id, assignment_key,
  source_type, source_ref, assigned_by_subject_id
)
SELECT learner.tenant_id, learner.learner_id, course.course_id,
       version.course_version_id,
       'lar-smoke:' || learner.learner_id::text,
       'RULE', rule_version.assignment_rule_version_id::text,
       'system:learning-assignment-automation'
  FROM platform.learning_learners learner
  JOIN platform.learning_courses course
    ON course.tenant_id = learner.tenant_id
  JOIN platform.learning_course_versions version
    ON version.tenant_id = course.tenant_id
   AND version.course_id = course.course_id
   AND version.version = 1
  JOIN platform.learning_assignment_rule_versions rule_version
    ON rule_version.tenant_id = learner.tenant_id
   AND rule_version.version = 1
 WHERE learner.tenant_id IN (
   '93939393-9393-4393-8393-939393939393'::uuid,
   '94949494-9494-4494-8494-949494949494'::uuid
 );

INSERT INTO platform.learning_assignment_rule_executions (
  tenant_id, assignment_rule_version_id, learner_id,
  evaluated_by_subject_id, correlation_id, outcome, target_type,
  enrollment_id, evaluated_at
)
SELECT learner.tenant_id, rule_version.assignment_rule_version_id,
       learner.learner_id, 'system:learning-assignment-automation',
       'assignment-smoke', 'ASSIGNED', 'COURSE',
       enrollment.enrollment_id, now()
  FROM platform.learning_learners learner
  JOIN platform.learning_assignment_rule_versions rule_version
    ON rule_version.tenant_id = learner.tenant_id
   AND rule_version.version = 1
  JOIN platform.learning_enrollments enrollment
    ON enrollment.tenant_id = learner.tenant_id
   AND enrollment.learner_id = learner.learner_id
 WHERE learner.tenant_id IN (
   '93939393-9393-4393-8393-939393939393'::uuid,
   '94949494-9494-4494-8494-949494949494'::uuid
 );

DO $$
DECLARE
  rule_version uuid;
  execution_id uuid;
BEGIN
  SELECT assignment_rule_version_id INTO rule_version
    FROM platform.learning_assignment_rule_versions
   WHERE tenant_id = '93939393-9393-4393-8393-939393939393'::uuid;

  BEGIN
    UPDATE platform.learning_assignment_rule_versions
       SET name = 'Tampered Rule'
     WHERE assignment_rule_version_id = rule_version;
    RAISE EXCEPTION 'published assignment rule mutation unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'published assignment rule mutation unexpectedly succeeded' THEN RAISE; END IF;
    IF POSITION('only draft learning assignment rule versions may edit policy' IN SQLERRM) = 0 THEN RAISE; END IF;
  END;

  SELECT assignment_rule_execution_id INTO execution_id
    FROM platform.learning_assignment_rule_executions
   WHERE tenant_id = '93939393-9393-4393-8393-939393939393'::uuid;

  BEGIN
    UPDATE platform.learning_assignment_rule_executions
       SET correlation_id = 'tampered'
     WHERE assignment_rule_execution_id = execution_id;
    RAISE EXCEPTION 'assignment execution mutation unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'assignment execution mutation unexpectedly succeeded' THEN RAISE; END IF;
    IF POSITION('executions are append-only' IN SQLERRM) = 0 THEN RAISE; END IF;
  END;
END;
$$;

DROP ROLE IF EXISTS expadio_learning_assignment_smoke;
CREATE ROLE expadio_learning_assignment_smoke NOLOGIN;
GRANT USAGE ON SCHEMA platform TO expadio_learning_assignment_smoke;
GRANT SELECT ON
  platform.learning_assignment_rules,
  platform.learning_assignment_rule_versions,
  platform.learning_assignment_rule_executions
TO expadio_learning_assignment_smoke;

SET ROLE expadio_learning_assignment_smoke;
SELECT set_config('app.tenant_id', '93939393-9393-4393-8393-939393939393', false);

DO $$
DECLARE
  rule_count integer;
  version_count integer;
  execution_count integer;
BEGIN
  SELECT count(*) INTO rule_count FROM platform.learning_assignment_rules;
  SELECT count(*) INTO version_count FROM platform.learning_assignment_rule_versions;
  SELECT count(*) INTO execution_count FROM platform.learning_assignment_rule_executions;

  IF rule_count <> 1 THEN RAISE EXCEPTION 'tenant A expected one rule, got %', rule_count; END IF;
  IF version_count <> 1 THEN RAISE EXCEPTION 'tenant A expected one rule version, got %', version_count; END IF;
  IF execution_count <> 1 THEN RAISE EXCEPTION 'tenant A expected one execution, got %', execution_count; END IF;
END;
$$;

RESET ROLE;

SELECT 'learning assignment automation smoke: ok' AS result;
