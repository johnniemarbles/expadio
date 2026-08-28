\set ON_ERROR_STOP on

-- The migration seeds exactly one ACTIVE platform access.request blueprint with a
-- SECURITY_REVIEW stage that is both participant-gated and decision-gated.
DO $$
DECLARE
  n integer;
  stage_count integer;
  review_ok boolean;
BEGIN
  SELECT count(*) INTO n
    FROM platform.workflow_blueprints
   WHERE tenant_id IS NULL AND blueprint_key = 'access.request'
     AND work_type_key = 'access.request' AND state = 'ACTIVE';
  IF n <> 1 THEN
    RAISE EXCEPTION 'expected exactly one ACTIVE platform access.request blueprint, found %', n;
  END IF;

  SELECT jsonb_array_length(stages) INTO stage_count
    FROM platform.workflow_blueprints
   WHERE tenant_id IS NULL AND blueprint_key = 'access.request' AND version = 1;
  IF stage_count <> 3 THEN
    RAISE EXCEPTION 'expected 3 access.request stages, found %', stage_count;
  END IF;

  SELECT (stage -> 'requiredParticipantKeys') ? 'security_reviewer'
         AND (stage ->> 'decisionRequired')::boolean
         AND (stage -> 'decisionOutcomes') ? 'APPROVE'
    INTO review_ok
    FROM platform.workflow_blueprints,
         LATERAL jsonb_array_elements(stages) AS stage
   WHERE tenant_id IS NULL AND blueprint_key = 'access.request'
     AND stage ->> 'stageKey' = 'SECURITY_REVIEW';
  IF review_ok IS NOT TRUE THEN
    RAISE EXCEPTION 'SECURITY_REVIEW must require a "security_reviewer" participant and a decision';
  END IF;
END;
$$;

-- Access-request row constraints.
INSERT INTO platform.tenants (tenant_id, name) VALUES
  ('d0000056-0056-0056-0056-000000000056', 'Access Tenant');

DO $$
BEGIN
  INSERT INTO platform.access_requests (tenant_id, resource)
  VALUES ('d0000056-0056-0056-0056-000000000056', 'prod-db:read');

  -- An empty resource is rejected.
  BEGIN
    INSERT INTO platform.access_requests (tenant_id, resource)
    VALUES ('d0000056-0056-0056-0056-000000000056', '');
    RAISE EXCEPTION 'access request with empty resource unexpectedly succeeded';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;

  -- An out-of-domain status is rejected.
  BEGIN
    INSERT INTO platform.access_requests (tenant_id, resource, status)
    VALUES ('d0000056-0056-0056-0056-000000000056', 'x', 'BOGUS');
    RAISE EXCEPTION 'access request with invalid status unexpectedly succeeded';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;
END;
$$;
