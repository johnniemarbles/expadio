BEGIN;

-- Platform-only CS-104 observation seed.
-- Writes domain event + frozen executor intents/attempts.
-- Does not send mail, does not insert communication_deliveries, does not mint T/B/L.

CREATE OR REPLACE FUNCTION platform.seed_cs104_observation(
  p_subject_id text,
  p_tenant_code text,
  p_brand_code text
)
RETURNS TABLE (
  correlation text,
  schedule_status text,
  task_status text,
  communicate_status text,
  delivery_state text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = platform, pg_temp
AS $$
DECLARE
  v_tenant_id uuid;
  v_event_id uuid;
  v_schedule_id uuid;
  v_task_id uuid;
  v_communicate_id uuid;
BEGIN
  IF p_subject_id IS NULL OR btrim(p_subject_id) = '' THEN
    RAISE EXCEPTION 'NO_MEMBERSHIP';
  END IF;
  IF p_tenant_code !~ '^T-[0-9]{4,}$' OR p_brand_code !~ '^B-[0-9]{4,}$' THEN
    RAISE EXCEPTION 'INVALID_PRODUCT_SCOPE_CODE';
  END IF;

  SELECT b.tenant_id INTO v_tenant_id
    FROM platform.product_scope_bindings b
    JOIN platform.memberships m
      ON m.tenant_id = b.tenant_id
     AND m.subject_id = p_subject_id
     AND m.status = 'ACTIVE'
   WHERE b.tenant_code = p_tenant_code
     AND b.brand_code = p_brand_code
     AND b.status = 'ACTIVE'
   ORDER BY CASE WHEN b.location_code = 'ALL' THEN 0 ELSE 1 END
   LIMIT 1;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'PRODUCT_SCOPE_MAPPING_NOT_FOUND';
  END IF;

  IF EXISTS (
    SELECT 1 FROM platform.governed_action_intents i
     WHERE i.tenant_id = v_tenant_id AND i.correlation_id = 'CS-104'
  ) THEN
    RETURN QUERY
    SELECT
      'CS-104'::text,
      COALESCE((SELECT a.status FROM platform.governed_action_intents i
        LEFT JOIN LATERAL (
          SELECT e.status FROM platform.governed_action_execution_attempts e
           WHERE e.tenant_id = i.tenant_id AND e.action_intent_id = i.action_intent_id
           ORDER BY e.created_at DESC LIMIT 1
        ) a ON true
        WHERE i.tenant_id = v_tenant_id AND i.correlation_id = 'CS-104' AND i.executor_class = 'SCHEDULE'
        LIMIT 1), 'ABSENT'),
      COALESCE((SELECT a.status FROM platform.governed_action_intents i
        LEFT JOIN LATERAL (
          SELECT e.status FROM platform.governed_action_execution_attempts e
           WHERE e.tenant_id = i.tenant_id AND e.action_intent_id = i.action_intent_id
           ORDER BY e.created_at DESC LIMIT 1
        ) a ON true
        WHERE i.tenant_id = v_tenant_id AND i.correlation_id = 'CS-104' AND i.executor_class = 'CREATE_TASK'
        LIMIT 1), 'ABSENT'),
      COALESCE((SELECT a.status FROM platform.governed_action_intents i
        LEFT JOIN LATERAL (
          SELECT e.status FROM platform.governed_action_execution_attempts e
           WHERE e.tenant_id = i.tenant_id AND e.action_intent_id = i.action_intent_id
           ORDER BY e.created_at DESC LIMIT 1
        ) a ON true
        WHERE i.tenant_id = v_tenant_id AND i.correlation_id = 'CS-104' AND i.executor_class = 'COMMUNICATE'
        LIMIT 1), 'ABSENT'),
      COALESCE((SELECT d.state FROM platform.communication_deliveries d
        JOIN platform.governed_action_intents i
          ON i.tenant_id = d.tenant_id AND i.idempotency_key = d.idempotency_key
       WHERE i.tenant_id = v_tenant_id AND i.correlation_id = 'CS-104' AND i.executor_class = 'COMMUNICATE'
       LIMIT 1), 'ABSENT');
    RETURN;
  END IF;

  v_event_id := gen_random_uuid();
  v_schedule_id := gen_random_uuid();
  v_task_id := gen_random_uuid();
  v_communicate_id := gen_random_uuid();

  INSERT INTO platform.domain_events (
    event_id, tenant_id, aggregate_type, aggregate_id, event_type,
    event_version, occurred_at, actor_subject_id, correlation_id,
    causation_id, pack_key, pack_version, payload, metadata
  ) VALUES (
    v_event_id, v_tenant_id, 'crm.case', 'CS-104', 'Case.Observed',
    1, now(), p_subject_id, 'CS-104',
    v_event_id::text, 'generic', 1,
    '{"stage":"OBSERVE"}'::jsonb,
    '{"source":"cs104-observation-seed"}'::jsonb
  );

  INSERT INTO platform.governed_action_intents (
    action_intent_id, tenant_id, source_event_id, source_event_type,
    aggregate_type, aggregate_id, rule_key, executor_class, action_key,
    idempotency_key, correlation_id, causation_id, requested_by_subject_id,
    requested_at, configuration, policy_decision
  ) VALUES
    (v_schedule_id, v_tenant_id, v_event_id, 'Case.Observed', 'crm.case', 'CS-104',
     'cs104.observe.schedule', 'SCHEDULE', 'observe.schedule',
     'cs104:schedule', 'CS-104', v_event_id::text, p_subject_id, now(),
     '{}'::jsonb, '{"allowed":true,"reasonCode":"ALLOWED"}'::jsonb),
    (v_task_id, v_tenant_id, v_event_id, 'Case.Observed', 'crm.case', 'CS-104',
     'cs104.observe.task', 'CREATE_TASK', 'observe.task',
     'cs104:task', 'CS-104', v_event_id::text, p_subject_id, now(),
     '{}'::jsonb, '{"allowed":true,"reasonCode":"ALLOWED"}'::jsonb),
    (v_communicate_id, v_tenant_id, v_event_id, 'Case.Observed', 'crm.case', 'CS-104',
     'cs104.observe.communicate', 'COMMUNICATE', 'observe.communicate',
     'cs104:communicate', 'CS-104', v_event_id::text, p_subject_id, now(),
     '{}'::jsonb, '{"allowed":true,"reasonCode":"ALLOWED"}'::jsonb);

  INSERT INTO platform.governed_action_execution_attempts (
    tenant_id, action_intent_id, executor_class, attempt_key, status,
    started_at, completed_at, reason_code, metadata
  ) VALUES
    (v_tenant_id, v_schedule_id, 'SCHEDULE', 'observe.schedule', 'SUCCEEDED', now(), now(), 'OBSERVED', '{}'::jsonb),
    (v_tenant_id, v_task_id, 'CREATE_TASK', 'observe.task', 'SUCCEEDED', now(), now(), 'OBSERVED', '{}'::jsonb),
    (v_tenant_id, v_communicate_id, 'COMMUNICATE', 'observe.communicate', 'SUCCEEDED', now(), now(), 'OBSERVED', '{}'::jsonb);

  correlation := 'CS-104';
  schedule_status := 'SUCCEEDED';
  task_status := 'SUCCEEDED';
  communicate_status := 'SUCCEEDED';
  delivery_state := 'ABSENT';
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION platform.seed_cs104_observation(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform.seed_cs104_observation(text, text, text) TO PUBLIC;

COMMENT ON FUNCTION platform.seed_cs104_observation(text, text, text) IS
  'Seeds CS-104 frozen executor facts. Does not send and does not mark delivery.';

COMMIT;
