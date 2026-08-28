\set ON_ERROR_STOP on

-- The migration seeds exactly one ACTIVE platform vendor.onboarding blueprint.
DO $$
DECLARE
  n integer;
  stage_count integer;
  screener_ok boolean;
BEGIN
  SELECT count(*) INTO n
    FROM platform.workflow_blueprints
   WHERE tenant_id IS NULL AND blueprint_key = 'vendor.onboarding'
     AND work_type_key = 'vendor.onboarding' AND state = 'ACTIVE';
  IF n <> 1 THEN
    RAISE EXCEPTION 'expected exactly one ACTIVE platform vendor.onboarding blueprint, found %', n;
  END IF;

  SELECT jsonb_array_length(stages) INTO stage_count
    FROM platform.workflow_blueprints
   WHERE tenant_id IS NULL AND blueprint_key = 'vendor.onboarding' AND version = 1;
  IF stage_count <> 3 THEN
    RAISE EXCEPTION 'expected 3 vendor.onboarding stages, found %', stage_count;
  END IF;

  -- The SCREENING stage names a required participant slot (the compliance gate).
  SELECT (stage ->> 'requiredParticipantKeys')::jsonb ? 'screener' INTO screener_ok
    FROM platform.workflow_blueprints,
         LATERAL jsonb_array_elements(stages) AS stage
   WHERE tenant_id IS NULL AND blueprint_key = 'vendor.onboarding'
     AND stage ->> 'stageKey' = 'SCREENING';
  IF screener_ok IS NOT TRUE THEN
    RAISE EXCEPTION 'SCREENING stage must require the "screener" participant';
  END IF;
END;
$$;

-- Vendor row constraints.
INSERT INTO platform.tenants (tenant_id, name) VALUES
  ('d0000053-0053-0053-0053-000000000053', 'Vendor Tenant');

DO $$
BEGIN
  -- A valid vendor inserts.
  INSERT INTO platform.vendors (tenant_id, legal_name, status)
  VALUES ('d0000053-0053-0053-0053-000000000053', 'Acme Supplies', 'PENDING');

  -- An out-of-domain status is rejected.
  BEGIN
    INSERT INTO platform.vendors (tenant_id, legal_name, status)
    VALUES ('d0000053-0053-0053-0053-000000000053', 'Bad Status', 'BOGUS');
    RAISE EXCEPTION 'vendor with invalid status unexpectedly succeeded';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;

  -- An empty legal_name is rejected.
  BEGIN
    INSERT INTO platform.vendors (tenant_id, legal_name)
    VALUES ('d0000053-0053-0053-0053-000000000053', '');
    RAISE EXCEPTION 'vendor with empty legal_name unexpectedly succeeded';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;
END;
$$;
