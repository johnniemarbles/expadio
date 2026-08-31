\set ON_ERROR_STOP on

INSERT INTO platform.tenants (tenant_id, name) VALUES
  ('a1a1a1a1-a1a1-41a1-81a1-a1a1a1a1a1a1', 'Learning Automation Smoke A'),
  ('b2b2b2b2-b2b2-42b2-82b2-b2b2b2b2b2b2', 'Learning Automation Smoke B');

INSERT INTO platform.learning_automation_rules (
  tenant_id, rule_key, event_type, executor_class, action_key,
  enabled, policy_keys, configuration, created_by_subject_id,
  updated_by_subject_id
) VALUES
  (
    'a1a1a1a1-a1a1-41a1-81a1-a1a1a1a1a1a1',
    'learning.course.review',
    'learning.course.completed',
    'CREATE_TASK',
    'learning.course.review',
    true,
    '[]'::jsonb,
    '{"title":"Review completed course","priority":"NORMAL"}'::jsonb,
    'admin-a',
    'admin-a'
  ),
  (
    'b2b2b2b2-b2b2-42b2-82b2-b2b2b2b2b2b2',
    'learning.course.review',
    'learning.course.completed',
    'CREATE_TASK',
    'learning.course.review',
    true,
    '[]'::jsonb,
    '{"title":"Review completed course","priority":"NORMAL"}'::jsonb,
    'admin-b',
    'admin-b'
  );

UPDATE platform.learning_automation_rules
   SET enabled = false,
       revision = 2,
       updated_by_subject_id = 'admin-a-2'
 WHERE tenant_id = 'a1a1a1a1-a1a1-41a1-81a1-a1a1a1a1a1a1'::uuid
   AND rule_key = 'learning.course.review';

DO $$
DECLARE
  actual_revision integer;
BEGIN
  SELECT revision INTO actual_revision
    FROM platform.learning_automation_rules
   WHERE tenant_id = 'a1a1a1a1-a1a1-41a1-81a1-a1a1a1a1a1a1'::uuid
     AND rule_key = 'learning.course.review';

  IF actual_revision <> 2 THEN
    RAISE EXCEPTION 'expected revision 2, got %', actual_revision;
  END IF;

  BEGIN
    UPDATE platform.learning_automation_rules
       SET enabled = true,
           revision = 4,
           updated_by_subject_id = 'admin-a-3'
     WHERE tenant_id = 'a1a1a1a1-a1a1-41a1-81a1-a1a1a1a1a1a1'::uuid
       AND rule_key = 'learning.course.review';
    RAISE EXCEPTION 'invalid automation revision jump unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'invalid automation revision jump unexpectedly succeeded' THEN
      RAISE;
    END IF;
    IF POSITION('revision must increment exactly once' IN SQLERRM) = 0 THEN
      RAISE;
    END IF;
  END;

  BEGIN
    UPDATE platform.learning_automation_rules
       SET rule_key = 'learning.changed.identity',
           revision = 3,
           updated_by_subject_id = 'admin-a-3'
     WHERE tenant_id = 'a1a1a1a1-a1a1-41a1-81a1-a1a1a1a1a1a1'::uuid
       AND rule_key = 'learning.course.review';
    RAISE EXCEPTION 'automation rule identity mutation unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'automation rule identity mutation unexpectedly succeeded' THEN
      RAISE;
    END IF;
    IF POSITION('identity and creation provenance are immutable' IN SQLERRM) = 0 THEN
      RAISE;
    END IF;
  END;
END;
$$;

DROP ROLE IF EXISTS expadio_learning_automation_smoke;
CREATE ROLE expadio_learning_automation_smoke NOLOGIN;
GRANT USAGE ON SCHEMA platform TO expadio_learning_automation_smoke;
GRANT SELECT ON platform.learning_automation_rules
TO expadio_learning_automation_smoke;

SET ROLE expadio_learning_automation_smoke;
SELECT set_config(
  'app.tenant_id',
  'a1a1a1a1-a1a1-41a1-81a1-a1a1a1a1a1a1',
  false
);

DO $$
DECLARE
  rule_count integer;
  visible_enabled boolean;
  visible_revision integer;
BEGIN
  SELECT count(*), bool_or(enabled), max(revision)
    INTO rule_count, visible_enabled, visible_revision
    FROM platform.learning_automation_rules;

  IF rule_count <> 1 THEN
    RAISE EXCEPTION 'tenant A expected one rule, got %', rule_count;
  END IF;
  IF visible_enabled IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'tenant A expected disabled rule';
  END IF;
  IF visible_revision <> 2 THEN
    RAISE EXCEPTION 'tenant A expected revision 2, got %', visible_revision;
  END IF;
END;
$$;

RESET ROLE;

SELECT 'learning automation smoke: ok' AS result;
