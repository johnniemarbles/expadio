\set ON_ERROR_STOP on

-- The migration seeds exactly one ACTIVE platform expense.reimbursement blueprint
-- with a MANAGER_REVIEW stage that is both participant-gated and decision-gated.
DO $$
DECLARE
  n integer;
  stage_count integer;
  review_ok boolean;
BEGIN
  SELECT count(*) INTO n
    FROM platform.workflow_blueprints
   WHERE tenant_id IS NULL AND blueprint_key = 'expense.reimbursement'
     AND work_type_key = 'expense.reimbursement' AND state = 'ACTIVE';
  IF n <> 1 THEN
    RAISE EXCEPTION 'expected exactly one ACTIVE platform expense.reimbursement blueprint, found %', n;
  END IF;

  SELECT jsonb_array_length(stages) INTO stage_count
    FROM platform.workflow_blueprints
   WHERE tenant_id IS NULL AND blueprint_key = 'expense.reimbursement' AND version = 1;
  IF stage_count <> 3 THEN
    RAISE EXCEPTION 'expected 3 expense.reimbursement stages, found %', stage_count;
  END IF;

  -- MANAGER_REVIEW requires a "manager" participant AND a decision.
  SELECT (stage -> 'requiredParticipantKeys') ? 'manager'
         AND (stage ->> 'decisionRequired')::boolean
         AND (stage -> 'decisionOutcomes') ? 'APPROVE'
    INTO review_ok
    FROM platform.workflow_blueprints,
         LATERAL jsonb_array_elements(stages) AS stage
   WHERE tenant_id IS NULL AND blueprint_key = 'expense.reimbursement'
     AND stage ->> 'stageKey' = 'MANAGER_REVIEW';
  IF review_ok IS NOT TRUE THEN
    RAISE EXCEPTION 'MANAGER_REVIEW must require a "manager" participant and a decision';
  END IF;
END;
$$;

-- Expense row constraints.
INSERT INTO platform.tenants (tenant_id, name) VALUES
  ('d0000055-0055-0055-0055-000000000055', 'Expense Tenant');

DO $$
BEGIN
  -- A valid expense inserts.
  INSERT INTO platform.expense_reports (tenant_id, purpose, amount_minor_units)
  VALUES ('d0000055-0055-0055-0055-000000000055', 'Travel', 12345);

  -- A non-positive amount is rejected.
  BEGIN
    INSERT INTO platform.expense_reports (tenant_id, purpose, amount_minor_units)
    VALUES ('d0000055-0055-0055-0055-000000000055', 'Zero', 0);
    RAISE EXCEPTION 'expense with non-positive amount unexpectedly succeeded';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;

  -- An out-of-domain status is rejected.
  BEGIN
    INSERT INTO platform.expense_reports (tenant_id, purpose, amount_minor_units, status)
    VALUES ('d0000055-0055-0055-0055-000000000055', 'Bad', 100, 'BOGUS');
    RAISE EXCEPTION 'expense with invalid status unexpectedly succeeded';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;
END;
$$;
