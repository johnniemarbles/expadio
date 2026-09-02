BEGIN;

ALTER TABLE platform.entity_ownership_interests
  ADD COLUMN IF NOT EXISTS enterprise_change_request_id uuid
    REFERENCES platform.enterprise_change_requests(enterprise_change_request_id)
    ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS source_legacy_ownership_interest_id uuid
    REFERENCES platform.ownership_interests(ownership_interest_id)
    ON DELETE RESTRICT;

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

COMMENT ON TABLE platform.entity_ownership_interests IS
  'Canonical governed ownership/control interests. New enterprise ownership changes use this registry-backed table and enterprise_change_requests; graph authority is published only after approval.';

COMMENT ON TABLE platform.ownership_interests IS
  'Legacy pre-registry ownership compatibility table. Existing rows remain readable but are not automatically treated as approved governed graph authority.';

COMMENT ON COLUMN platform.entity_ownership_interests.enterprise_change_request_id IS
  'Enterprise CHANGE_OWNERSHIP request that governs creation/decision of this interest.';

COMMIT;
