BEGIN;

ALTER TABLE platform.entity_ownership_interests
  ADD COLUMN IF NOT EXISTS enterprise_change_request_id uuid
    REFERENCES platform.enterprise_change_requests(enterprise_change_request_id)
    ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS source_legacy_ownership_interest_id uuid
    REFERENCES platform.ownership_interests(ownership_interest_id)
    ON DELETE RESTRICT;

DO $
DECLARE
  constraint_name text;
BEGIN
  FOR constraint_name IN
    SELECT conname
      FROM pg_constraint
     WHERE conrelid = 'platform.entity_ownership_interests'::regclass
       AND contype = 'c'
       AND pg_get_constraintdef(oid) LIKE '%status = %APPROVED%'
       AND pg_get_constraintdef(oid) LIKE '%approved_by_subject_id%'
  LOOP
    EXECUTE format(
      'ALTER TABLE platform.entity_ownership_interests DROP CONSTRAINT %I',
      constraint_name
    );
  END LOOP;
END;
$;

ALTER TABLE platform.entity_ownership_interests
  ADD CONSTRAINT entity_ownership_interests_approval_metadata_check
  CHECK (
    (status IN ('APPROVED','SUPERSEDED'))
    = (approved_by_subject_id IS NOT NULL AND approved_at IS NOT NULL)
  );

CREATE UNIQUE INDEX IF NOT EXISTS entity_ownership_interests_change_request_uq
  ON platform.entity_ownership_interests (tenant_id, enterprise_change_request_id)
  WHERE enterprise_change_request_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS entity_ownership_interests_current_approved_uq
  ON platform.entity_ownership_interests (
    tenant_id,
    owner_node_id,
    subject_node_id,
    interest_type
  )
  WHERE status = 'APPROVED' AND valid_until IS NULL;

CREATE INDEX IF NOT EXISTS entity_ownership_interests_change_request_idx
  ON platform.entity_ownership_interests (
    tenant_id,
    enterprise_change_request_id,
    status
  )
  WHERE enterprise_change_request_id IS NOT NULL;

INSERT INTO platform.entity_relationship_definitions (
  tenant_id,
  relationship_key,
  source_node_type,
  target_node_type,
  inverse_relationship_key,
  perspective,
  cardinality,
  requires_approval,
  status,
  created_by_subject_id
) VALUES
  (NULL, 'OWNERSHIP_EQUITY', 'LEGAL_ENTITY', 'LEGAL_ENTITY', 'EQUITY_OWNED_BY', 'OWNERSHIP_LEGAL', 'MANY_TO_MANY', true, 'ACTIVE', 'platform'),
  (NULL, 'OWNERSHIP_VOTING', 'LEGAL_ENTITY', 'LEGAL_ENTITY', 'VOTING_OWNED_BY', 'OWNERSHIP_LEGAL', 'MANY_TO_MANY', true, 'ACTIVE', 'platform'),
  (NULL, 'OWNERSHIP_ECONOMIC', 'LEGAL_ENTITY', 'LEGAL_ENTITY', 'ECONOMIC_OWNED_BY', 'OWNERSHIP_LEGAL', 'MANY_TO_MANY', true, 'ACTIVE', 'platform'),
  (NULL, 'OWNERSHIP_CONTROL', 'LEGAL_ENTITY', 'LEGAL_ENTITY', 'CONTROLLED_BY', 'OWNERSHIP_LEGAL', 'MANY_TO_MANY', true, 'ACTIVE', 'platform'),
  (NULL, 'OWNERSHIP_BENEFICIAL', 'LEGAL_ENTITY', 'LEGAL_ENTITY', 'BENEFICIALLY_OWNED_BY', 'OWNERSHIP_LEGAL', 'MANY_TO_MANY', true, 'ACTIVE', 'platform')
ON CONFLICT DO NOTHING;

INSERT INTO platform.entity_relationship_definitions (
  tenant_id,
  relationship_key,
  source_node_type,
  target_node_type,
  inverse_relationship_key,
  perspective,
  cardinality,
  requires_approval,
  status,
  created_by_subject_id
) VALUES (
  NULL,
  'LEGAL_IDENTITY',
  'OPERATING_UNIT',
  'LEGAL_ENTITY',
  'LEGAL_ENTITY_FOR',
  'OWNERSHIP_LEGAL',
  'MANY_TO_ONE',
  false,
  'ACTIVE',
  'platform'
)
ON CONFLICT DO NOTHING;

DO $$
DECLARE
  item record;
BEGIN
  FOR item IN
    SELECT DISTINCT ON (binding.tenant_id, binding.organization_id)
      binding.tenant_id,
      binding.organization_id,
      binding.legal_entity_id,
      binding.organization_legal_entity_binding_id,
      binding.valid_from
    FROM platform.organization_legal_entity_bindings binding
    JOIN platform.legal_entities legal_entity
      ON legal_entity.tenant_id = binding.tenant_id
     AND legal_entity.legal_entity_id = binding.legal_entity_id
    WHERE binding.binding_role = 'OPERATED_BY'
      AND binding.status = 'ACTIVE'
      AND binding.valid_from <= now()
      AND (binding.valid_until IS NULL OR binding.valid_until > now())
      AND legal_entity.status = 'VERIFIED'
      AND legal_entity.valid_from <= now()
      AND (legal_entity.valid_until IS NULL OR legal_entity.valid_until > now())
    ORDER BY
      binding.tenant_id,
      binding.organization_id,
      binding.valid_from DESC,
      binding.organization_legal_entity_binding_id DESC
  LOOP
    PERFORM platform.create_governed_entity_relationship(
      item.tenant_id,
      'OPERATING_UNIT',
      item.organization_id::text,
      'LEGAL_IDENTITY',
      'LEGAL_ENTITY',
      item.legal_entity_id::text,
      'enterprise-ownership-backfill',
      'SYSTEM',
      item.valid_from,
      NULL,
      NULL,
      'backfill:legal-identity',
      jsonb_build_object(
        'bindingId', item.organization_legal_entity_binding_id,
        'source', 'platform.organization_legal_entity_bindings'
      )
    );
  END LOOP;
END;
$$;

COMMENT ON TABLE platform.entity_ownership_interests IS
  'Canonical governed ownership/control interests. New enterprise ownership changes use this registry-backed table and enterprise_change_requests; graph authority is published only after approval.';

COMMENT ON TABLE platform.ownership_interests IS
  'Legacy pre-registry ownership compatibility table. Existing rows remain readable but are not automatically treated as approved governed graph authority.';

COMMENT ON COLUMN platform.entity_ownership_interests.enterprise_change_request_id IS
  'Enterprise CHANGE_OWNERSHIP request that governs creation/decision of this interest.';

COMMIT;
