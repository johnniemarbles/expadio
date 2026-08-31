\set ON_ERROR_STOP on
BEGIN;
INSERT INTO platform.tenants (tenant_id, name) VALUES
 ('a8500000-0000-0000-0000-000000000001', 'Audit scope tenant A'),
 ('a8500000-0000-0000-0000-000000000002', 'Audit scope tenant B');
INSERT INTO platform.organizations (organization_id, tenant_id, name) VALUES
 ('a8510000-0000-0000-0000-000000000001', 'a8500000-0000-0000-0000-000000000001', 'Org A1'),
 ('a8510000-0000-0000-0000-000000000002', 'a8500000-0000-0000-0000-000000000001', 'Org A2'),
 ('a8510000-0000-0000-0000-000000000003', 'a8500000-0000-0000-0000-000000000002', 'Org B');

-- Test-only preparation of an unassigned pre-migration row. Restore the new-row
-- constraint before exercising access; no policy is disabled or replaced.
ALTER TABLE platform.agent_runs DROP CONSTRAINT agent_runs_new_organization_required;
INSERT INTO platform.agent_runs (run_id, tenant_id, organization_id, agent_id, purpose, context_bundle_reference,
 budget_policy_reference, idempotency_key, requested_by_subject_id, requested_at, created_at, reason, correlation_id, evidence_refs)
SELECT ('a8520000-0000-0000-0000-00000000000' || n)::uuid,
 CASE WHEN n = 3 THEN 'a8500000-0000-0000-0000-000000000002'::uuid ELSE 'a8500000-0000-0000-0000-000000000001'::uuid END,
 CASE WHEN n = 4 THEN NULL ELSE ('a8510000-0000-0000-0000-00000000000' || n)::uuid END,
 'agent', 'test', 'context:test', 'budget:test', 'audit-org-' || n, 'reader', now(), now(), 'test', gen_random_uuid(), ARRAY['test']
FROM generate_series(1,4) n;
ALTER TABLE platform.agent_runs ADD CONSTRAINT agent_runs_new_organization_required CHECK (organization_id IS NOT NULL) NOT VALID;

INSERT INTO platform.agent_run_events (event_id, run_id, tenant_id, organization_id, sequence, event_type, event_reference,
 occurred_at, actor_subject_id, reason, correlation_id, evidence_refs)
SELECT gen_random_uuid(), run_id, tenant_id, organization_id, 1, 'STARTED', 'run:test', now(), 'reader', 'test', correlation_id, ARRAY['test']
FROM platform.agent_runs WHERE run_id IN ('a8520000-0000-0000-0000-000000000001','a8520000-0000-0000-0000-000000000002','a8520000-0000-0000-0000-000000000003');
INSERT INTO platform.sensitive_read_events (event_id, request_id, tenant_id, organization_id, requested_by_subject_id,
 resource_type, resource_id, purpose, legal_basis, authorization_decision_id, authorization_reason_key, outcome,
 requested_at, recorded_at, correlation_id, evidence_refs, classifications, source_references, failure_reason_key)
SELECT gen_random_uuid(), 'audit-scope-' || organization_id, tenant_id, organization_id, 'reader', 'document', 'doc', 'test', 'test',
 'decision', 'DENIED', 'DENIED', now(), now(), gen_random_uuid(), ARRAY['test'], ARRAY[]::text[], ARRAY[]::text[], 'DENIED'
FROM platform.organizations WHERE name IN ('Org A1','Org A2','Org B') AND tenant_id IN ('a8500000-0000-0000-0000-000000000001','a8500000-0000-0000-0000-000000000002');

CREATE ROLE expadio_audit_scope_test NOLOGIN NOSUPERUSER NOBYPASSRLS;
GRANT USAGE ON SCHEMA platform TO expadio_audit_scope_test;
GRANT SELECT, INSERT, UPDATE ON platform.agent_runs, platform.agent_run_events, platform.sensitive_read_events TO expadio_audit_scope_test;
SET LOCAL ROLE expadio_audit_scope_test;
SELECT set_config('app.tenant_id', 'a8500000-0000-0000-0000-000000000001', true);
SELECT set_config('app.organization_id', 'a8510000-0000-0000-0000-000000000001', true);
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user AND (rolsuper OR rolbypassrls)) THEN RAISE EXCEPTION 'RLS test role bypasses RLS'; END IF;
 IF (SELECT count(*) FROM platform.agent_runs) <> 1 THEN RAISE EXCEPTION 'agent run org/legacy isolation failed'; END IF;
 IF (SELECT count(*) FROM platform.agent_run_events) <> 1 THEN RAISE EXCEPTION 'agent event org isolation failed'; END IF;
 IF (SELECT count(*) FROM platform.sensitive_read_events) <> 1 THEN RAISE EXCEPTION 'sensitive read org isolation failed'; END IF;
 IF EXISTS (SELECT 1 FROM platform.agent_runs WHERE run_id = 'a8520000-0000-0000-0000-000000000002') THEN RAISE EXCEPTION 'cross-org resource exposed'; END IF;
 BEGIN
   INSERT INTO platform.agent_runs (run_id, tenant_id, organization_id, agent_id, purpose, context_bundle_reference,
    budget_policy_reference, idempotency_key, requested_by_subject_id, requested_at, created_at, reason, correlation_id, evidence_refs)
   VALUES (gen_random_uuid(), 'a8500000-0000-0000-0000-000000000001','a8510000-0000-0000-0000-000000000002',
    'agent','test','context','budget','forged-org','reader',now(),now(),'test',gen_random_uuid(),ARRAY['test']);
   RAISE EXCEPTION 'cross-org insert succeeded';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT set_config('app.organization_id', 'a8510000-0000-0000-0000-000000000002', true);
DO $$ BEGIN
 IF (SELECT count(*) FROM platform.agent_runs) <> 1 OR NOT EXISTS (SELECT 1 FROM platform.agent_runs WHERE run_id = 'a8520000-0000-0000-0000-000000000002') THEN RAISE EXCEPTION 'same-tenant second organization incorrect'; END IF;
END $$;
SELECT set_config('app.organization_id', '', true);
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM platform.agent_runs) OR EXISTS (SELECT 1 FROM platform.agent_run_events) OR EXISTS (SELECT 1 FROM platform.sensitive_read_events) THEN RAISE EXCEPTION 'missing organization exposed history'; END IF;
END $$;
SELECT set_config('app.organization_id', 'a8510000-0000-0000-0000-000000000003', true);
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM platform.agent_runs) THEN RAISE EXCEPTION 'foreign tenant organization exposed history'; END IF;
END $$;
RESET ROLE;
-- Legacy scope was never inferred or rewritten.
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM platform.agent_runs WHERE run_id='a8520000-0000-0000-0000-000000000004' AND organization_id IS NULL) THEN RAISE EXCEPTION 'legacy history changed'; END IF;
END $$;
ROLLBACK;
