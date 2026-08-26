\set ON_ERROR_STOP on

INSERT INTO platform.tenants (tenant_id, name) VALUES
  ('42000000-0000-0000-0000-000000000001', 'Capability Tenant A'),
  ('42000000-0000-0000-0000-000000000002', 'Capability Tenant B');

INSERT INTO platform.agent_capability_manifests (
  manifest_id, kind, capability_key, version, state,
  scope_kind, scope_key, tenant_id, owner_subject_id,
  instruction_reference, instruction_digest, input_schema, output_schema,
  required_permission_keys, allowed_tool_keys, negative_constraint_keys,
  budget_policy_reference, max_steps, max_cost_minor_units, timeout_seconds,
  stop_condition_keys, escalation_policy_reference, skill_references,
  verified_at, effective_from, evidence_refs
) VALUES
  (
    '42100000-0000-0000-0000-000000000001',
    'SKILL', 'source-verify', 1, 'PUBLISHED',
    'PLATFORM', NULL, NULL, 'platform-owner',
    'instruction://source-verify/1',
    'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    '{"schemaReference":"schema://source/input/1","schemaDigest":"sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}',
    '{"schemaReference":"schema://source/output/1","schemaDigest":"sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"}',
    ARRAY['knowledge.read'], ARRAY['knowledge.search'],
    ARRAY['NO_DIRECT_MUTATION'], 'budget://agent/default',
    8, 250, 90, ARRAY['OBJECTIVE_MET'], 'escalation://human-review',
    '[]'::jsonb, '2026-08-27T00:00:00Z', '2026-08-27T00:00:00Z',
    ARRAY['verification://source-verify/1']
  ),
  (
    '42100000-0000-0000-0000-000000000002',
    'SKILL', 'source-verify', 1, 'PUBLISHED',
    'VERTICAL', 'dentex', NULL, 'vertical-owner',
    'instruction://dentex/source-verify/1',
    'sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
    '{"schemaReference":"schema://dentex/source/input/1","schemaDigest":"sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"}',
    '{"schemaReference":"schema://dentex/source/output/1","schemaDigest":"sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"}',
    ARRAY['knowledge.read'], ARRAY['knowledge.search'],
    ARRAY['NO_DIRECT_MUTATION'], 'budget://agent/dentex',
    8, 250, 90, ARRAY['OBJECTIVE_MET'], 'escalation://dentex-review',
    '[]'::jsonb, '2026-08-27T00:00:00Z', '2026-08-27T00:00:00Z',
    ARRAY['verification://dentex/source-verify/1']
  ),
  (
    '42100000-0000-0000-0000-000000000003',
    'WORKER', 'knowledge-worker', 1, 'DRAFT',
    'TENANT', '42000000-0000-0000-0000-000000000001',
    '42000000-0000-0000-0000-000000000001', 'tenant-owner-a',
    'instruction://tenant-a/knowledge-worker/1',
    'sha256:1111111111111111111111111111111111111111111111111111111111111111',
    '{"schemaReference":"schema://worker/input/1","schemaDigest":"sha256:2222222222222222222222222222222222222222222222222222222222222222"}',
    '{"schemaReference":"schema://worker/output/1","schemaDigest":"sha256:3333333333333333333333333333333333333333333333333333333333333333"}',
    ARRAY['knowledge.read'], ARRAY['knowledge.search'],
    ARRAY['HUMAN_APPROVAL_FOR_MUTATION'], 'budget://tenant-a/worker',
    12, 500, 120, ARRAY['OBJECTIVE_MET'], 'escalation://tenant-a-review',
    '[{"key":"source-verify","version":1}]'::jsonb,
    NULL, '2026-08-28T00:00:00Z', ARRAY['draft://tenant-a/worker/1']
  ),
  (
    '42100000-0000-0000-0000-000000000004',
    'WORKER', 'knowledge-worker', 1, 'PUBLISHED',
    'TENANT', '42000000-0000-0000-0000-000000000002',
    '42000000-0000-0000-0000-000000000002', 'tenant-owner-b',
    'instruction://tenant-b/knowledge-worker/1',
    'sha256:4444444444444444444444444444444444444444444444444444444444444444',
    '{"schemaReference":"schema://worker/input/1","schemaDigest":"sha256:5555555555555555555555555555555555555555555555555555555555555555"}',
    '{"schemaReference":"schema://worker/output/1","schemaDigest":"sha256:6666666666666666666666666666666666666666666666666666666666666666"}',
    ARRAY['knowledge.read'], ARRAY['knowledge.search'],
    ARRAY['HUMAN_APPROVAL_FOR_MUTATION'], 'budget://tenant-b/worker',
    12, 500, 120, ARRAY['OBJECTIVE_MET'], 'escalation://tenant-b-review',
    '[{"key":"source-verify","version":1}]'::jsonb,
    '2026-08-27T00:00:00Z', '2026-08-27T00:00:00Z',
    ARRAY['verification://tenant-b/worker/1']
  );

DROP ROLE IF EXISTS expadio_agent_capability_test;
CREATE ROLE expadio_agent_capability_test NOLOGIN;
GRANT USAGE ON SCHEMA platform TO expadio_agent_capability_test;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON platform.agent_capability_manifests
  TO expadio_agent_capability_test;

SET ROLE expadio_agent_capability_test;
SELECT set_config(
  'app.tenant_id',
  '42000000-0000-0000-0000-000000000001',
  false
);

DO $$
DECLARE
  manifest_count integer;
BEGIN
  SELECT count(*) INTO manifest_count
    FROM platform.agent_capability_manifests;
  IF manifest_count <> 3 THEN
    RAISE EXCEPTION 'tenant A expected platform, vertical, and own manifests only';
  END IF;
END;
$$;

UPDATE platform.agent_capability_manifests
   SET state = 'PUBLISHED',
       verified_at = '2026-08-27T01:00:00Z'
 WHERE manifest_id = '42100000-0000-0000-0000-000000000003';

DO $$
DECLARE
  published_state text;
BEGIN
  SELECT state INTO published_state
    FROM platform.agent_capability_manifests
   WHERE manifest_id = '42100000-0000-0000-0000-000000000003';
  IF published_state <> 'PUBLISHED' THEN
    RAISE EXCEPTION 'tenant manifest did not publish';
  END IF;
END;
$$;

DO $$
BEGIN
  BEGIN
    INSERT INTO platform.agent_capability_manifests (
      manifest_id, kind, capability_key, version, state,
      scope_kind, scope_key, tenant_id, owner_subject_id,
      instruction_reference, instruction_digest, input_schema, output_schema,
      required_permission_keys, allowed_tool_keys, negative_constraint_keys,
      budget_policy_reference, max_steps, max_cost_minor_units, timeout_seconds,
      stop_condition_keys, escalation_policy_reference, skill_references,
      verified_at, effective_from, evidence_refs
    ) VALUES (
      '42100000-0000-0000-0000-000000000005',
      'SKILL', 'cross-tenant', 1, 'DRAFT',
      'TENANT', '42000000-0000-0000-0000-000000000002',
      '42000000-0000-0000-0000-000000000002', 'tenant-owner-a',
      'instruction://cross/1',
      'sha256:7777777777777777777777777777777777777777777777777777777777777777',
      '{"schemaReference":"schema://cross/input/1","schemaDigest":"sha256:8888888888888888888888888888888888888888888888888888888888888888"}',
      '{"schemaReference":"schema://cross/output/1","schemaDigest":"sha256:9999999999999999999999999999999999999999999999999999999999999999"}',
      ARRAY['knowledge.read'], ARRAY[]::text[], ARRAY['NO_CROSS_TENANT'],
      'budget://cross', 1, 0, 30, ARRAY['STOP'], 'escalation://cross',
      '[]'::jsonb, NULL, now(), ARRAY['negative://cross-tenant']
    );
    RAISE EXCEPTION 'cross-tenant manifest insert unexpectedly succeeded';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;
END;
$$;

DO $$
BEGIN
  BEGIN
    UPDATE platform.agent_capability_manifests
       SET instruction_reference = 'instruction://mutated'
     WHERE manifest_id = '42100000-0000-0000-0000-000000000003';
    RAISE EXCEPTION 'published manifest content mutation unexpectedly succeeded';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM NOT LIKE 'Agent capability manifest content is immutable%' THEN
        RAISE;
      END IF;
  END;
END;
$$;

RESET ROLE;

DO $$
BEGIN
  BEGIN
    DELETE FROM platform.agent_capability_manifests
     WHERE manifest_id = '42100000-0000-0000-0000-000000000001';
    RAISE EXCEPTION 'manifest deletion unexpectedly succeeded';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM NOT LIKE 'Agent capability manifest history is immutable%' THEN
        RAISE;
      END IF;
  END;
END;
$$;

DO $$
BEGIN
  BEGIN
    INSERT INTO platform.agent_capability_manifests (
      manifest_id, kind, capability_key, version, state,
      scope_kind, scope_key, tenant_id, owner_subject_id,
      instruction_reference, instruction_digest, input_schema, output_schema,
      required_permission_keys, allowed_tool_keys, negative_constraint_keys,
      budget_policy_reference, max_steps, max_cost_minor_units, timeout_seconds,
      stop_condition_keys, escalation_policy_reference, skill_references,
      verified_at, effective_from, evidence_refs
    ) VALUES (
      '42100000-0000-0000-0000-000000000006',
      'WORKER', 'invalid-worker', 1, 'PUBLISHED',
      'PLATFORM', NULL, NULL, 'platform-owner',
      'instruction://invalid-worker/1',
      'sha256:abababababababababababababababababababababababababababababababab',
      '{"schemaReference":"schema://invalid/input/1","schemaDigest":"sha256:bcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbc"}',
      '{"schemaReference":"schema://invalid/output/1","schemaDigest":"sha256:cdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd"}',
      ARRAY['knowledge.read'], ARRAY['knowledge.search'], ARRAY['NO_RECURSION'],
      'budget://invalid', 2, 10, 30, ARRAY['STOP'], 'escalation://invalid',
      '[{"key":"source-verify","version":1},{"key":"source-verify","version":1}]'::jsonb,
      now(), now(), ARRAY['negative://duplicate-reference']
    );
    RAISE EXCEPTION 'duplicate worker skill references unexpectedly succeeded';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;
END;
$$;

SELECT 'Agent capability manifest persistence smoke: ok' AS result;
