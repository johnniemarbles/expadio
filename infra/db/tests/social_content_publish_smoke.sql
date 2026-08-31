\set ON_ERROR_STOP on

-- Expect exactly one ACTIVE platform social.content_publish blueprint with a
-- BRAND_REVIEW stage that is participant-gated and decision-gated.
DO $$
DECLARE
  n integer;
  stage_count integer;
  review_ok boolean;
BEGIN
  SELECT count(*) INTO n
    FROM platform.workflow_blueprints
   WHERE tenant_id IS NULL AND blueprint_key = 'social.content_publish'
     AND work_type_key = 'social.content_publish' AND state = 'ACTIVE';
  IF n <> 1 THEN
    RAISE EXCEPTION 'expected exactly one ACTIVE platform social.content_publish blueprint, found %', n;
  END IF;

  SELECT jsonb_array_length(stages) INTO stage_count
    FROM platform.workflow_blueprints
   WHERE tenant_id IS NULL AND blueprint_key = 'social.content_publish' AND version = 1;
  IF stage_count <> 3 THEN
    RAISE EXCEPTION 'expected 3 social.content_publish stages, found %', stage_count;
  END IF;

  SELECT (stage -> 'requiredParticipantKeys') ? 'brand_approver'
         AND (stage ->> 'decisionRequired')::boolean
         AND (stage -> 'decisionOutcomes') ? 'APPROVE'
    INTO review_ok
    FROM platform.workflow_blueprints,
         LATERAL jsonb_array_elements(stages) AS stage
   WHERE tenant_id IS NULL AND blueprint_key = 'social.content_publish'
     AND stage ->> 'stageKey' = 'BRAND_REVIEW';
  IF review_ok IS NOT TRUE THEN
    RAISE EXCEPTION 'BRAND_REVIEW must require a "brand_approver" participant and a decision';
  END IF;
END;
$$;

INSERT INTO platform.tenants (tenant_id, name) VALUES
  ('d0000057-0057-0057-0057-000000000057', 'Social Content Tenant')
ON CONFLICT DO NOTHING;

DO $$
BEGIN
  INSERT INTO platform.social_content_items (tenant_id, body, platforms)
  VALUES ('d0000057-0057-0057-0057-000000000057', 'Hello EXPADIO', ARRAY['linkedin']);

  BEGIN
    INSERT INTO platform.social_content_items (tenant_id, body, status)
    VALUES ('d0000057-0057-0057-0057-000000000057', 'x', 'BOGUS');
    RAISE EXCEPTION 'social content with invalid status unexpectedly succeeded';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;
END;
$$;
