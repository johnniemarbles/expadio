\set ON_ERROR_STOP on

INSERT INTO platform.tenants (tenant_id, name) VALUES
  ('41000000-0000-0000-0000-000000000001', 'Brain Tenant A'),
  ('41000000-0000-0000-0000-000000000002', 'Brain Tenant B');

INSERT INTO platform.company_brain_correction_proposals (
  proposal_reference, tenant_id, execution_id, proposer_subject_id, agent_id,
  category, target_kind, target_reference,
  original_output_reference, original_output_digest,
  proposed_correction_reference, proposed_correction_digest,
  reason_key, created_at, correlation_id, evidence_refs
) VALUES
  (
    'correction://proposal/a', '41000000-0000-0000-0000-000000000001',
    'execution-a', 'subject-a', 'agent-a', 'OUTDATED_FACT', 'COMPANY_FACT',
    'knowledge://fact/a', 'agent-output://a',
    'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    'correction-delta://a',
    'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    'SOURCE_SUPERSEDED', now(), '41100000-0000-0000-0000-000000000001',
    ARRAY['evidence://a']
  ),
  (
    'correction://proposal/b', '41000000-0000-0000-0000-000000000002',
    'execution-b', 'subject-b', 'agent-b', 'DANGEROUS_ACTION', 'MECHANICAL_GATE',
    'gate://dangerous-action', 'agent-output://b',
    'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
    'correction-delta://b',
    'sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
    'GATE_REQUIRED', now(), '41100000-0000-0000-0000-000000000002',
    ARRAY['evidence://b']
  );

DROP ROLE IF EXISTS expadio_brain_correction_test;
CREATE ROLE expadio_brain_correction_test NOLOGIN;
GRANT USAGE ON SCHEMA platform TO expadio_brain_correction_test;
GRANT SELECT, INSERT, UPDATE, DELETE ON platform.company_brain_correction_proposals
  TO expadio_brain_correction_test;

SET ROLE expadio_brain_correction_test;
SELECT set_config('app.tenant_id', '41000000-0000-0000-0000-000000000001', false);

DO $$
DECLARE proposal_count integer;
BEGIN
  SELECT count(*) INTO proposal_count
    FROM platform.company_brain_correction_proposals;
  IF proposal_count <> 1 THEN
    RAISE EXCEPTION 'tenant A can see another tenant correction proposal';
  END IF;
END;
$$;

DO $$
BEGIN
  BEGIN
    INSERT INTO platform.company_brain_correction_proposals (
      proposal_reference, tenant_id, execution_id, proposer_subject_id, agent_id,
      category, target_kind, target_reference,
      original_output_reference, original_output_digest,
      proposed_correction_reference, proposed_correction_digest,
      reason_key, created_at, correlation_id, evidence_refs
    ) VALUES (
      'correction://proposal/cross', '41000000-0000-0000-0000-000000000002',
      'execution-cross', 'subject-a', 'agent-a', 'OUTDATED_FACT', 'COMPANY_FACT',
      'knowledge://fact/b', 'agent-output://cross',
      'sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
      'correction-delta://cross',
      'sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
      'CROSS_TENANT', now(), '41100000-0000-0000-0000-000000000003',
      ARRAY['evidence://cross']
    );
    RAISE EXCEPTION 'cross-tenant correction insert unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$$;

RESET ROLE;

DO $$
BEGIN
  BEGIN
    UPDATE platform.company_brain_correction_proposals
       SET reason_key = 'MUTATED'
     WHERE proposal_reference = 'correction://proposal/a';
    RAISE EXCEPTION 'correction mutation unexpectedly succeeded';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'Company Brain correction history is immutable%' THEN RAISE; END IF;
  END;
END;
$$;

DO $$
BEGIN
  BEGIN
    INSERT INTO platform.company_brain_correction_proposals (
      proposal_reference, tenant_id, execution_id, proposer_subject_id, agent_id,
      category, target_kind, target_reference,
      original_output_reference, original_output_digest,
      proposed_correction_reference, proposed_correction_digest,
      reason_key, created_at, correlation_id, evidence_refs
    ) VALUES (
      'correction://proposal/invalid', '41000000-0000-0000-0000-000000000001',
      'execution-invalid', 'subject-a', 'agent-a', 'OUTDATED_FACT', 'POLICY',
      'policy://wrong-target', 'agent-output://invalid',
      'sha256:1111111111111111111111111111111111111111111111111111111111111111',
      'correction-delta://invalid',
      'sha256:2222222222222222222222222222222222222222222222222222222222222222',
      'INVALID_TARGET', now(), '41100000-0000-0000-0000-000000000004',
      ARRAY['evidence://invalid']
    );
    RAISE EXCEPTION 'invalid correction target unexpectedly succeeded';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END;
$$;

SELECT 'Company Brain correction history smoke: ok' AS result;
